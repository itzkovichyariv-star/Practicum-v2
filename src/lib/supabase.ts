import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export type Student = {
  id: string; name: string; phone?: string; email?: string; city?: string;
  courseId: string; year?: string;
  acceptedOrg?: string; hired?: boolean;
  preparation?: { passed?: boolean; date?: string };
  hoursReported?: number; hoursApproved?: number;
  cvUrl?: string; formUrl?: string; feedbackText?: string;
  cvUpdatedUrl?: string;  // post-prep updated CV required before org placement
  // Organization preference flow (1st choice → if fails, try 2nd)
  firstChoiceOrg?: string;
  firstChoiceResult?: 'pending' | 'passed' | 'failed';
  secondChoiceOrg?: string;
  secondChoiceResult?: 'pending' | 'passed' | 'failed';
  fromCandidateId?: string;
  practicumCompleted?: boolean;  // מילא חובות שעות וסיים פרקטיקום
  notes?: string; fromCandidate?: boolean;
};
export type Employer = {
  id: string; name: string; contactPerson?: string; contactPhone?: string; contactEmail?: string;
  courseId: string; year?: string;
  positions?: number; filledPositions?: number; location?: string;
};
export type Candidate = {
  id: string; name: string; phone?: string; email?: string;
  city?: string;
  courseId: string; year?: string;
  applicationDate?: string;
  interviewDate?: string;
  interviewResult?: 'passed' | 'failed' | 'pending';
  // Structured interview evaluation (ported from v1)
  preferredArea?: string;        // desired HR domain
  evalCommitment?: string;       // נמוך / בינוני / גבוה / מצטיין
  evalMotivation?: string;       // נמוכה / בינונית / גבוהה / גבוהה מאוד
  evalCommunication?: string;    // חלשה / בינונית / טובה / מצוינת
  evalEnglish?: string;          // בסיסית / טובה / טובה מאוד / שפת אם
  evalAcquaintance?: string;     // אין / מעט / טובה / רחבה
  evalScore?: number;            // 0–100 overall
  interviewSummary?: string;     // free text notes
  rejectionReason?: string;      // required when failed
  notes?: string;
  cvUrl?: string;
  applicationUrl?: string;
  submittedAt?: string;
  convertedToStudentId?: string;
};
export type Lecture = {
  id: string; courseId?: string; courseName?: string; year?: string;
  title?: string; topic?: string; lecturer?: string; lecturerEmail?: string; lecturerPhone?: string;
  date?: string; startTime?: string; endTime?: string;
  type?: string; semester?: string; institution?: string; location?: string; link?: string;
  status?: string; cost?: string | number; notes?: string;
  graphEventId?: string;  // Microsoft Graph event ID (for instant Outlook sync)
};
export type Course = { id: string; name: string; year?: string; institution?: string };
export type Trainer = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  organization?: string;  // the host org where they supervise
  role?: string;          // their job title / role
  specialty?: string;     // HR domain expertise
  courseId: string;
  year?: string;
  studentIds?: string[];  // IDs of students they supervise
  notes?: string;
};

export type InterviewSlot = {
  id: string;
  date: string;       // YYYY-MM-DD
  startTime: string;  // HH:MM
  endTime: string;    // HH:MM
  capacity: number;   // how many candidates can book this slot
  bookedCount: number; // how many have booked so far
  courseName?: string; // optional filter — which course this slot is for
  note?: string;
};

export type PracticumData = {
  courses?: Course[];
  students?: Student[];
  employers?: Employer[];
  trainers?: Trainer[];
  candidates?: Candidate[];
  lectures?: Lecture[];
  institutions?: string[];
  academicYears?: string[];
  currentCourse?: string;
  currentYear?: string;
  interviewSlots?: InterviewSlot[];
  history?: { ts: string; who: string; action: string; entity: string; target: string }[];
};

export type CloudSnapshot = {
  data: PracticumData;
  updated_at: string;
  last_editor_name?: string;
  last_editor_email?: string;
};

export async function loadSnapshot(): Promise<CloudSnapshot | null> {
  const { data, error } = await supabase
    .from('practicum_data')
    .select('data, updated_at, last_editor_name, last_editor_email')
    .eq('org_id', 'default')
    .single();
  if (error) {
    console.warn('[cloud] load error:', error.message);
    return null;
  }
  return data as CloudSnapshot;
}
