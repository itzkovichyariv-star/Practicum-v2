import { test, expect } from '@playwright/test';
import { adoptSubmittedOrgs, submissionHasUnappliedOrgs, submissionHasNewCv } from '../src/lib/placement';

/**
 * The card's pending banner and the strip's chip both ask "is this submission still
 * waiting to be taken in?" — and they answered it with two separate copies of the test,
 * which drifted. The card's copy compared the record's org fields to the submission's
 * FIELD BY FIELD, so a record that legitimately carried more organizations than the
 * submission could never match it again.
 *
 * That is exactly what a correct adopt produces: `adoptSubmittedOrgs` KEEPS an
 * organization the student did not resubmit, because it may be holding a reserved place.
 * So from the moment adopt started doing the right thing, the banner nagged forever —
 * gate cell 53, 2026-09-15.
 */

const employers: any = [{ id: 'e1', name: 'ארגון ראשון' }, { id: 'e2', name: 'ארגון חדש' }];

test('THE BUG: after adopting, the banner must not nag again', () => {
  // The seed gate cell 53 uses: one organization on the record, a re-submission naming
  // a different one.
  const student: any = { id: 's1', name: 'בדיקת החלפה', firstChoiceOrg: 'ארגון ראשון' };
  const submitted = ['ארגון חדש'];
  expect(submissionHasUnappliedOrgs(submitted, student)).toBe(true); // before adopting

  const after = adoptSubmittedOrgs(student, employers, submitted);
  // Adopt keeps 'ארגון ראשון' — it may hold a place — so the record now has TWO orgs
  // while the submission named one. The record is ahead of the submission, not behind.
  expect(after.secondChoiceOrg).toBe('ארגון ראשון');
  expect(submissionHasUnappliedOrgs(submitted, after)).toBe(false);
});

test('a CV-only submission never reads as an org list waiting (הדר עוזירי, 2026-08-09)', () => {
  const student: any = { firstChoiceOrg: 'ארגון ראשון', secondChoiceOrg: 'ארגון חדש' };
  expect(submissionHasUnappliedOrgs([null, null, null], student)).toBe(false);
  expect(submissionHasUnappliedOrgs([], student)).toBe(false);
});

test('an organization that is genuinely not on the record is still surfaced', () => {
  const student: any = { firstChoiceOrg: 'ארגון ראשון' };
  expect(submissionHasUnappliedOrgs(['ארגון ראשון', 'ארגון שלישי'], student)).toBe(true);
});

test('an invisible RTL mark in a submitted name is not a difference', () => {
  const student: any = { firstChoiceOrg: 'עיריית אריאל' };
  expect(submissionHasUnappliedOrgs(['‏עיריית אריאל '], student)).toBe(false);
});

test('a submission with no file at all carries no new CV', () => {
  const student: any = { cvUpdatedUrl: 'storage://candidate-uploads/cv-updates/s1-FIRST.docx' };
  expect(submissionHasNewCv('', student)).toBe(false);
  expect(submissionHasNewCv(null, student)).toBe(false);
  expect(submissionHasNewCv('cv-updates/s1-FIRST.docx', student)).toBe(false);
  expect(submissionHasNewCv('cv-updates/s1-SECOND.docx', student)).toBe(true);
});
