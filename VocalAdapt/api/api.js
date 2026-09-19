import { supabase } from './supabase.js';

// ==========================================
// THESIS CORE: BAYESIAN KNOWLEDGE TRACING
// ==========================================

// 1. Fetch live Skill Mastery from child_skill_states
export async function getStudentMasteryData() {
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

    const formattedStudents = data.map(student => {
        let totalInteractions = 0;
        let cumulativeMastery = 0;
        let skillCount = 0;
        let lowestSkill = { name: "None", p_mastery: 1.0 };

        student.child_skill_states.forEach(state => {
            totalInteractions += state.interactions_count;
            cumulativeMastery += state.p_mastery;
            skillCount++;
            
            if (state.p_mastery < lowestSkill.p_mastery) {
                lowestSkill = { name: state.skills?.name || "Unknown", p_mastery: state.p_mastery };
            }
        });

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

    return formattedStudents.sort((a, b) => a.avg_mastery - b.avg_mastery);
}

// 2. Fetch Question level analytics (Struggle Areas & Response Time)
export async function getQuestionAnalytics() {
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
        .order('success_rate', { ascending: true });

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
    
    return data;
}

// FETCH ADAPTIVE QUESTION (RESTORED THESIS LOGIC)
export async function getNextQuestion(childId) {
    try {
        let targetDifficulty = 1; 
        let answeredQuestionIds = [];

        // 1. Fetch ALL past interactions
        if (childId) {
            const { data: pastInteractions } = await supabase
                .from('interactions')
                .select(`question_id, is_correct, questions!inner(difficulty_level)`)
                .eq('child_id', childId)
                .order('created_at', { ascending: false });

            if (pastInteractions && pastInteractions.length > 0) {
                const lastInteraction = pastInteractions[0];
                const lastDiff = lastInteraction.questions?.difficulty_level || 1;

                if (lastInteraction.is_correct) {
                    targetDifficulty = Math.min(5, lastDiff + 1);
                } else {
                    targetDifficulty = Math.max(1, lastDiff - 1);
                }
                
                answeredQuestionIds = pastInteractions.map(p => p.question_id);
            }
        }

        // 2. Fetch questions at new target difficulty, excluding answered ones
        // Note: select('*') will automatically grab our new `question_type` and `visual_data` columns!
        let query = supabase
            .from('questions')
            .select('*')
            .eq('difficulty_level', targetDifficulty);
            
        if (answeredQuestionIds.length > 0) {
            query = query.not('id', 'in', `(${answeredQuestionIds.join(',')})`);
        }

        let { data, error } = await query;

        // 3. Fallback if no questions exist at this difficulty
        if (!data || data.length === 0) {
             let fallbackQuery = supabase.from('questions').select('*');
             
             if (answeredQuestionIds.length > 0) {
                 fallbackQuery = fallbackQuery.not('id', 'in', `(${answeredQuestionIds.join(',')})`);
             }
             
             const { data: fallbackData } = await fallbackQuery;
             
             if (fallbackData && fallbackData.length > 0) {
                 data = fallbackData;
             } else {
                 console.log("No unseen questions left in the database.");
                 return null; 
             }
        }

        // 4. Pick random question
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

export async function addQuestion(skillId, promptText, expectedAnswer, difficultyLevel, questionType = 'text', visualData = null) {
    const { data, error } = await supabase.from('questions').insert([
        { 
            skill_id: skillId, 
            prompt_text: promptText, 
            expected_answer: expectedAnswer, 
            difficulty_level: parseInt(difficultyLevel),
            question_type: questionType,
            visual_data: visualData
        }
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