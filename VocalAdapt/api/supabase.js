// api/supabase.js
// Import Supabase from the official CDN
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://oxjkxfdypkyxuzknapva.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94amt4ZmR5cGt5eHV6a25hcHZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3ODU2NTgsImV4cCI6MjEwNTM2MTY1OH0.SJn37jJytPOWlpiQkLO2_5aZnDxLCe2jVqWzWFxS1-U';

// Initialize the Supabase client
export const supabase = createClient(supabaseUrl, supabaseKey);