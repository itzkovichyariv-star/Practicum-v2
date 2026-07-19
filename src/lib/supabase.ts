import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ── Placement extension types ─────────────────────────────────────────────────

export type VacancySlotStatus = 'available' | 'tentative' | 'under_review' | 'placed';

export type VacancySlot = {
  id: string;
  courseId: string;
  status: VacancySlotStatus;
  studentId?: string | null;
  prefRank?: number | null;
  history: Array<{
    at: string;
    from: VacancySlotStatus | null;
    to: VacancySlotStatus;
    by: 'admin' | 'student' | 'system';
    actorId?: string;
    reason?: string;
  }>;
};

export type StudentPreference = {
  rank: number;
  employerId: string;
  /** null until a CV is actually SENT to this employer — sending is what takes a
   *  place. A preference on its own reserves nothing (buildPlacementPreferences). */
  slotId: string | null;
  /** 'tentative' = chosen, no CV sent yet · 'under_review' = CV sent, place taken. */
  status: 'tentative' | 'under_review' | 'rejected' | 'placed' | 'withdrawn';
};

export type Dispatch = {
  id: string;
  studentId: string;
  employerId: string;
  slotId: string;
  channel: 'whatsapp' | 'email';
  sentBy: string;
  sentAt: string;
  messageSnapshot: string;
  result: 'pending' | 'rejected' | 'placed' | 'withdrawn';
  resultAt?: string | null;
  resultBy?: string | null;
};

export type EmployerApprovalRequest = {
  id: string;
  requesterStudentId: string;
  courseId: string;
  draft: {
    name?: string;
    contact?: string;
    phone?: string;
    email?: string;
    location?: string;
    description?: string;
    positionsTotal?: number;
  };
  status: 'pending' | 'approved' | 'rejected';
  decision?: 'student-only' | 'course-wide' | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  createdAt: string;
  resultingEmployerId?: string | null;
};

export type PlacementSettings = {
  defaultPreferenceCount: number;
  defaultAgingThresholdDays: number;
  whatsappTemplate: string;
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
  whatsappWithdrawalTemplate: string;
  emailWithdrawalSubjectTemplate: string;
  emailWithdrawalBodyTemplate: string;
  studentNotifyApprovedTemplateWhatsApp: string;
  studentNotifyApprovedTemplateEmailSubject: string;
  studentNotifyApprovedTemplateEmailBody: string;
  studentNotifyRejectedTemplateWhatsApp: string;
  studentNotifyRejectedTemplateEmailSubject: string;
  studentNotifyRejectedTemplateEmailBody: string;
};

export type Student = {
  id: string; name: string; phone?: string; email?: string; city?: string;
  courseId: string; year?: string;
  acceptedOrg?: string; hired?: boolean;
  preparation?: { passed?: boolean; date?: string };
  hoursReported?: number; hoursApproved?: number;
  cvUrl?: string; formUrl?: string; feedbackText?: string;
  cvUpdatedUrl?: string;  // post-prep updated CV required before org placement
  // The original application form (questionnaire) the candidate submitted via the
  // public link — carried over on conversion so it travels with the person and is
  // shown with its original design in the student card. Same shape as Candidate.
  questionnaire?: Candidate['questionnaire'];
  // Organization preference flow (1st choice → if fails, try 2nd)
  firstChoiceOrg?: string;
  firstChoiceResult?: 'pending' | 'passed' | 'failed';
  secondChoiceOrg?: string;
  secondChoiceResult?: 'pending' | 'passed' | 'failed';
  fromCandidateId?: string;
  practicumCompleted?: boolean;  // מילא חובות שעות וסיים פרקטיקום
  notes?: string; fromCandidate?: boolean;
  // Placement interview (Rachel's workflow — separate from admission interview)
  placementInterviewDate?: string;  // YYYY-MM-DD
  placementInterviewTime?: string;  // HH:MM
  placementInterviewOrg?: string;   // employer visited (may differ from firstChoiceOrg during process)
  // Employer feedback
  feedbackToken?: string;        // opaque token sent to employer for the feedback form URL
  feedbackRequestedAt?: string;  // ISO timestamp when the feedback link was FIRST generated/sent — anchors the weekly reminder clock (see feedback-reminders Edge Function)
  feedbackSubmittedAt?: string;  // ISO timestamp when employer submitted feedback
  // Email tracking
  acceptanceEmailSent?: boolean; // true after acceptance email was sent
  rejectionEmailSent?: boolean;  // true after rejection email was sent
  // Placement date — auto-set when acceptedOrg is first recorded
  placedAt?: string;             // ISO date (YYYY-MM-DD) when placement was logged
  // Placement extension
  cvShareUrl?: string | null;
  submissionStatus?: 'not_submitted' | 'submitted' | 'under_review' | 'placed' | 'exhausted';
  submittedAt?: string | null;
  preferences?: StudentPreference[];
  legacyPreferences?: string[];
};
export type Employer = {
  id: string; name: string; contactPerson?: string; contactPhone?: string; contactEmail?: string;
  /** New: master record linked to multiple courses. Replaces courseId+year. */
  courseIds?: string[];
  /** @deprecated use courseIds */
  courseId?: string;
  /** @deprecated year is on the course record, not the employer */
  year?: string;
  positions?: number; filledPositions?: number; location?: string;
  notes?: string;
  // Placement extension
  positionsTotal?: number;
  vacancySlots?: VacancySlot[];
  addedBy?: 'admin' | string;
  approvalStatus?: 'approved' | 'pending' | 'rejected';
  restrictedToStudentId?: string | null;
  // Admin workflow status (traffic light — see employerStatus()):
  //   🟢 מאושר   = derived: has a description AND open places (> 0)
  //   🟠 בתהליך  = contactStatus 'in_process' (contacted, no place yet) + statusNote
  //   ⚪ טרם פניתי = contactStatus 'not_contacted' (default)
  //   🔴 נדחה    = approvalStatus 'rejected'
  contactStatus?: 'not_contacted' | 'in_process';
  statusNote?: string;
};
export type Candidate = {
  id: string; name: string; phone?: string; email?: string;
  city?: string;
  courseId: string; year?: string;
  applicationDate?: string;
  interviewDate?: string;
  interviewResult?: 'passed' | 'failed' | 'pending';
  interviewConducted?: boolean;     // the interview actually took place (assess now, decide later)
  interviewConductedAt?: string;    // ISO timestamp it was marked conducted
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
  interviewTime?: string;        // HH:MM–HH:MM from booked slot (e.g. "10:00–10:45")
  notes?: string;
  cvUrl?: string;
  applicationUrl?: string;
  submittedAt?: string;
  convertedToStudentId?: string;
  // Email tracking
  acceptanceEmailSent?: boolean;
  rejectionEmailSent?: boolean;
  // Questionnaire answers (copied from candidate_submissions on intake)
  questionnaire?: {
    studyTracks?: string; gpa?: string; workHistory?: string;
    favRole?: string; leastFavRole?: string; whyPracticum?: string;
    whySuitable?: string; persistence?: string; expectations?: string;
  } | null;
};
export type Lecture = {
  id: string; courseId?: string; courseName?: string; year?: string;
  title?: string; topic?: string; lecturer?: string; lecturerEmail?: string; lecturerPhone?: string;
  date?: string; startTime?: string; endTime?: string;
  type?: string; semester?: string; institution?: string; location?: string; link?: string;
  status?: string; cost?: string | number; notes?: string;
  graphEventId?: string;  // Microsoft Graph event ID (for instant Outlook sync)
};
export type Course = {
  id: string; name: string; year?: string; institution?: string;
  // Linked institutions (multiple, collapsible in UI)
  linkedInstitutions?: string[];
  // Email automation settings (per course)
  autoSendAcceptance?: boolean;  // send acceptance email automatically when candidate is converted to student
  autoSendRejection?: boolean;   // send rejection email automatically when candidate is marked as failed
  // Placement extension
  type?: 'practicum' | 'other';
  preferenceCount?: number;
  reviewAgingThresholdDays?: number;
  acceptanceNote?: string;
  workshopDate?: string;   // תאריך סדנת הכנה לפרקטיקום — used in acceptance email {{תאריך_סדנה}}
};
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
  // Zoom link per interview DAY (ISO date → join link). Stored independently of
  // public_interview_slots so deleting/changing slots never deletes the link, and
  // every candidate interviewing that day gets the same link in their confirmation.
  interviewZoomLinks?: Record<string, string>;
  history?: { ts: string; who: string; action: string; entity: string; target: string }[];
  // System settings
  coordinatorEmail?: string;  // coordinator (Rachel) — receives employer feedback + candidate submissions
  supervisorEmail?: string;   // academic supervisor (Yariv) — also receives copies of all notifications
  notifyEmails?: string[];    // additional email addresses to CC on system notifications
  // Placement extension
  dispatches?: Dispatch[];
  employerApprovalRequests?: EmployerApprovalRequest[];
  placementSettings?: PlacementSettings;
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
