import { createClient } from '@supabase/supabase-js'

// Ve a Supabase -> Project Settings -> API para obtener estos datos:
const supabaseUrl = 'https://ggecznwbxpwybxmvmuog.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnZWN6bndieHB3eWJ4bXZtdW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0OTY4MTUsImV4cCI6MjA4MjA3MjgxNX0.DFDn-q6d-H4R4GwTZvFjMT-q8yPLKYbkjLyY57Rxw_Y'

export const supabase = createClient(supabaseUrl, supabaseKey)