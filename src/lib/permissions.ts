import type { PracticumData } from './supabase';

export type UserPermissions = {
  role: 'admin' | 'coordinator';
  /** If non-empty, only these courseIds are visible to this user. Empty = see all. */
  allowedCourseIds?: string[];
};

/** Map known coordinator emails to restricted permissions. Add more rows as needed. */
const ROLE_MAP: Record<string, UserPermissions> = {
  // Rachel sees only her own courses — add her real email here:
  // 'rachel@ariel.ac.il': { role: 'coordinator', allowedCourseIds: ['course-rachel-id'] },
};

export function permissionsFor(email: string | null | undefined): UserPermissions {
  if (!email) return { role: 'admin' };
  const lower = email.toLowerCase().trim();
  return ROLE_MAP[lower] ?? { role: 'admin' };
}

export function filterByPermissions(data: PracticumData, perms: UserPermissions): PracticumData {
  const ids = perms.allowedCourseIds;
  if (!ids || ids.length === 0) return data;
  const allowed = new Set(ids);
  return {
    ...data,
    courses:    (data.courses    || []).filter(c => allowed.has(c.id)),
    students:   (data.students   || []).filter(s => allowed.has(s.courseId)),
    lectures:   (data.lectures   || []).filter(l => allowed.has(l.courseId ?? '')),
    candidates: (data.candidates || []).filter(c => allowed.has(c.courseId)),
    employers:  (data.employers  || []).filter(e => allowed.has(e.courseId ?? '')),
    trainers:   (data.trainers   || []).filter(t => allowed.has(t.courseId)),
  };
}

export function describePermissions(perms: UserPermissions): string {
  return perms.role === 'admin' ? 'מנהל' : 'רכזת';
}
