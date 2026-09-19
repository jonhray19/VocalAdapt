import { supabase } from './supabase.js';

// ==========================================
// THESIS CORE: BAYESIAN KNOWLEDGE TRACING
// ==========================================

// 1. Fetch live Skill Mastery from child_skill_states
export async function getStudentMasteryData() {
    // Fetch students, joined with their skill states and the skill names
    const { data, error } = await supabase
        .from('child_profiles')
        .select(`
            id, 
            first_name,
            child_skill_states (
                p_mastery,
                interactions_count,
                skills ( name, domain )
            )
        `);

    if (error) {
        console.error("Error fetching student BKT mastery:", error);
        return [];
    }

    // Transform for the dashboard table
    const formattedStudents = data.map(student => {
        let totalInteractions = 0;
        let cumulativeMastery = 0;
        let skillCount = 0;
        let lowestSkill = { name: "None", p_mastery: 1.0 };

        student.child_skill_states.forEach(state => {
            totalInteractions += state.interactions_count;
            cumulativeMastery += state.p_mastery;
            skillCount++;
            
            // Find the skill they are struggling with most
            if (state.p_mastery < lowestSkill.p_mastery) {
                lowestSkill = { name: state.skills?.name || "Unknown", p_mastery: state.p_mastery };
            }
        });

        // Calculate an overall aggregate mastery percentage across all skills
        const avgMastery = skillCount > 0 ? (cumulativeMastery / skillCount) : 0;

        return {
            id: student.id,
            name: student.first_name,
            interactions: totalInteractions,
            avg_mastery: avgMastery,
            lowest_skill: lowestSkill.name,
            lowest_skill_p: lowestSkill.p_mastery
        };
    });

    // Sort by lowest mastery first to highlight at-risk students
    return formattedStudents.sort((a, b) => a.avg_mastery - b.avg_mastery);
}

// 2. Fetch Question level analytics (Struggle Areas & Response Time)
export async function getQuestionAnalytics() {
    // Using the aggregated question_analytics table from schema
    const { data, error } = await supabase
        .from('question_analytics')
        .select(`
            total_attempts,
            total_correct,
            total_incorrect,
            success_rate,
            avg_response_time_ms,
            questions ( prompt_text, expected_answer, difficulty_level, skills(name) )
        `)
        .order('success_rate', { ascending: true }); // Lowest success first

    if (error) {
        console.error("Error fetching question analytics:", error);
        return { overview: { total: 0 }, questions: [] };
    }

    let globalAttempts = 0;
    let globalCorrect = 0;

    const formattedQuestions = data.map(row => {
        globalAttempts += row.total_attempts;
        globalCorrect += row.total_correct;

        return {
            prompt: row.questions?.prompt_text || "Unknown",
            target: row.questions?.expected_answer || "Unknown",
            skill: row.questions?.skills?.name || "Unknown",
            difficulty: row.questions?.difficulty_level || 1,
            attempts: row.total_attempts,
            correct: row.total_correct,
            incorrect: row.total_incorrect,
            success_rate: row.success_rate,
            avg_rt_ms: row.avg_response_time_ms
        };
    });

    return {
        overview: {
            totalAttempts: globalAttempts,
            totalCorrect: globalCorrect,
            globalSuccessRate: globalAttempts > 0 ? (globalCorrect / globalAttempts) : 0
        },
        questions: formattedQuestions
    };
}


// ==========================================
// STANDARD AUTH & DATA LOGGING
// ==========================================

export async function logInteraction(childId, questionId, isCorrect, actualTranscript, responseTimeMs) {
    
    const { data: qData } = await supabase
        .from('questions')
        .select('skill_id')
        .eq('id', questionId)
        .single();

    const skillId = qData ? qData.skill_id : null;

    // Log the raw interaction including response_time_ms
    const { data, error } = await supabase
        .from('interactions')
        .insert([
            {
                child_id: childId,
                question_id: questionId,
                skill_id: skillId, 
                is_correct: isCorrect,
                actual_transcript: actualTranscript,
                confidence_score: 0.95,
                response_time_ms: responseTimeMs 
            }
        ]);
    
    if (error) {
        console.error("Database Insert Error:", error);
        throw error;
    }
    
    // Note: In a true production environment, a database trigger or edge function
    // should immediately recalculate p_mastery in child_skill_states using BKT formulas.
    return data;
}

// FETCH ADAPTIVE QUESTION (RESTORED THESIS LOGIC)
export async function getNextQuestion(childId) {
    try {
        let targetDifficulty = 1; 
        let answeredQuestionIds = [];

        // 1. Fetch ALL past interactions for this child to avoid repeating
        if (childId) {
            const { data: pastInteractions } = await supabase
                .from('interactions')
                .select(`question_id, is_correct, questions!inner(difficulty_level)`)
                .eq('child_id', childId)
                .order('created_at', { ascending: false });

            if (pastInteractions && pastInteractions.length > 0) {
                const lastInteraction = pastInteractions[0];
                const lastDiff = lastInteraction.questions?.difficulty_level || 1;

                // THESIS CORE: Adaptive Sequencing Rules
                if (lastInteraction.is_correct) {
                    targetDifficulty = Math.min(5, lastDiff + 1); // Level Up
                } else {
                    targetDifficulty = Math.max(1, lastDiff - 1); // Level Down
                }
                
                // Collect ALL previously answered question IDs
                answeredQuestionIds = pastInteractions.map(p => p.question_id);
            }
        }

        // 2. Fetch questions at the new target difficulty, EXCLUDING answered ones
        let query = supabase
            .from('questions')
            .select('*')
            .eq('difficulty_level', targetDifficulty);
            
        if (answeredQuestionIds.length > 0) {
            query = query.not('id', 'in', `(${answeredQuestionIds.join(',')})`);
        }

        let { data, error } = await query;

        // 3. If no questions exist at this difficulty, search ALL difficulties for an unseen question
        if (!data || data.length === 0) {
             let fallbackQuery = supabase.from('questions').select('*');
             
             if (answeredQuestionIds.length > 0) {
                 fallbackQuery = fallbackQuery.not('id', 'in', `(${answeredQuestionIds.join(',')})`);
             }
             
             const { data: fallbackData } = await fallbackQuery;
             
             if (fallbackData && fallbackData.length > 0) {
                 data = fallbackData;
             } else {
                 // The student has answered literally every question in the DB.
                 // Return null to signal the frontend to stop the session.
                 console.log("No unseen questions left in the database.");
                 return null; 
             }
        }

        // 4. Pick one random question from the available, unseen pool
        if (data && data.length > 0) {
            const randomIndex = Math.floor(Math.random() * data.length);
            return data[randomIndex];
        }
        
        return null;
    } catch (err) {
        console.error("Adaptive Sequencing Error:", err);
        return null;
    }
}

export async function getSkills() {
    const { data, error } = await supabase.from('skills').select('*').order('domain');
    return data;
}
export async function addQuestion(skillId, promptText, expectedAnswer, difficultyLevel) {
    const { data, error } = await supabase.from('questions').insert([
        { skill_id: skillId, prompt_text: promptText, expected_answer: expectedAnswer, difficulty_level: parseInt(difficultyLevel) }
    ]);
    if (error) throw error;
    return data;
}
export async function addStudent(firstName, dateOfBirth, avatarEmoji) {
    const { data, error } = await supabase.from('child_profiles').insert([
        { first_name: firstName, date_of_birth: dateOfBirth, avatar_url: avatarEmoji }
    ]).select(); 
    if (error) throw error;
    return data;
}
export async function getStudents() {
    const { data, error } = await supabase.from('child_profiles').select('*').order('created_at', { ascending: false });
    return data;
}
export async function signUpTeacher(email, password) {
    const { data, error } = await supabase.auth.signUp({ email: email, password: password });
    if (error) throw error;
    if (data.user) await supabase.from('parent_profiles').insert([{ id: data.user.id, email: data.user.email }]);
    return data;
}
export async function signInTeacher(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email, password: password });
    if (error) throw error;
    return data;
}
export async function logoutUser() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}
export async function loginStudent(childId) {
    const { data, error } = await supabase.from('child_profiles').select('id, first_name, avatar_url').eq('id', childId).single();
    if (error || !data) throw new Error("Student ID not found.");
    return data;
}