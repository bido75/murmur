// Ready-made summary templates. Adding one copies it into your templates, where you can edit it.
import type { Template } from './types';

export type LibraryTemplate = { name: string; category: string; base: Template; instructions: string };

const t = (category: string, name: string, base: Template, instructions: string): LibraryTemplate => ({ category, name, base, instructions });

export const TEMPLATE_LIBRARY: LibraryTemplate[] = [
  // Construction and field
  t('Construction', 'OAC meeting', 'meeting', 'Sections: Schedule, Budget and change orders, RFIs and submittals, Safety, Owner decisions needed. Start with a one-line status (on track / at risk / behind).'),
  t('Construction', 'Daily huddle', 'site_walk', 'Sections: Crews on site, Today’s work by area, Hazards and controls, Deliveries, Blockers. Keep each item to one line.'),
  t('Construction', 'Safety toolbox talk', 'general', 'Sections: Topic, Key hazards discussed, Controls agreed, Questions raised, Attendees mentioned. Note anything that needs follow-up by a supervisor.'),
  t('Construction', 'Punch walk', 'site_walk', 'List every deficiency as "Location: issue" in key points, grouped by floor or area. Action items are fixes with the trade responsible when said.'),
  t('Construction', 'Pre-construction kickoff', 'meeting', 'Sections: Scope, Key dates, Roles and contacts, Site logistics, Permits and inspections, Risks.'),
  t('Construction', 'Subcontractor coordination', 'meeting', 'Sections: Sequencing conflicts, Access and staging, Lookahead (next 2 weeks), Commitments by trade.'),
  t('Construction', 'Change order review', 'meeting', 'Sections: Changes discussed (scope, reason, cost and time impact as said), Approved, Pending, Rejected.'),
  // Sales
  t('Sales', 'Discovery call', 'sales_call', 'Sections: Situation, Pain points, Current solution, Decision process and people, Budget, Timeline, Next step. Quote the customer’s own words for pains.'),
  t('Sales', 'MEDDIC', 'sales_call', 'Sections: Metrics, Economic buyer, Decision criteria, Decision process, Identify pain, Champion. Mark any section not covered as "Not discussed".'),
  t('Sales', 'Demo debrief', 'sales_call', 'Sections: What resonated, Objections and how they were handled, Feature requests, Competitors mentioned, Next step.'),
  t('Sales', 'Negotiation', 'sales_call', 'Sections: Terms discussed, Concessions offered (each side), Open terms, Deadline. Never round numbers; use them exactly as said.'),
  // Customer success and support
  t('Customer success', 'QBR', 'meeting', 'Sections: Goals and results, Usage and adoption, Risks, Expansion opportunities, Commitments by each side.'),
  t('Customer success', 'Onboarding call', 'meeting', 'Sections: Customer goals, Setup steps completed, Blockers, Training needed, Next session.'),
  t('Customer success', 'Support escalation', 'phone_call', 'Sections: Issue as described, Impact, Steps already tried, Workaround, Owner and next update time.'),
  // Product and engineering
  t('Product & engineering', 'Standup', 'meeting', 'For each person: Yesterday, Today, Blockers. Use their name as the heading of each key point.'),
  t('Product & engineering', 'Sprint planning', 'meeting', 'Sections: Sprint goal, Committed work, Stretch, Risks and dependencies.'),
  t('Product & engineering', 'Retrospective', 'meeting', 'Sections: Went well, Didn’t go well, Ideas, Agreed changes. Agreed changes are the action items.'),
  t('Product & engineering', 'User interview', 'interview', 'Sections: Who they are, Jobs to be done, Pains (with quotes), Workarounds, Reactions to ideas shown. Do not suggest features.'),
  t('Product & engineering', 'Design review', 'meeting', 'Sections: What was reviewed, Feedback by area, Decisions, Open questions for the designer.'),
  t('Product & engineering', 'Incident review', 'meeting', 'Sections: Timeline, Impact, Root cause, What went well, Follow-ups (with owners). Blameless wording.'),
  // People and leadership
  t('People', 'One-on-one', 'meeting', 'Sections: Wins, Challenges, Feedback (both directions), Career and growth, Commitments.'),
  t('People', 'Candidate interview', 'interview', 'Sections: Background, Answers by topic, Strengths (with evidence), Concerns (with evidence), Questions they asked. No hiring recommendation.'),
  t('People', 'Performance review', 'meeting', 'Sections: Goals and results, Strengths, Growth areas, Agreed goals for next period.'),
  t('People', 'All-hands', 'lecture', 'Sections: Announcements, Metrics shared, Q&A (question and answer pairs), Dates to remember.'),
  t('People', 'Board meeting', 'meeting', 'Sections: Financials as presented, Strategic topics, Board feedback, Resolutions and votes, Follow-ups.'),
  // Professional services
  t('Professional services', 'Client intake', 'meeting', 'Sections: Client and matter, Facts as described, Goals, Deadlines, Documents requested, Fee discussion.'),
  t('Professional services', 'Legal consultation', 'meeting', 'Sections: Facts, Issues raised, Advice given (as said), Next steps and deadlines. Not legal advice; record only what was said.'),
  t('Professional services', 'Real estate showing', 'site_walk', 'Sections: Property, Features liked, Concerns (by room or area), Questions for the seller, Next step.'),
  t('Professional services', 'Patient visit (with consent)', 'meeting', 'Sections: Reason for visit, History as described, Discussion, Plan, Follow-up. Record only what was said; no diagnoses beyond what the clinician stated.'),
  // Education and personal
  t('Education', 'Lecture notes', 'lecture', 'Sections: Main ideas, Definitions, Examples, Formulas or dates, Questions to review. Write as study notes.'),
  t('Education', 'Study group', 'meeting', 'Sections: Topics covered, Explanations that helped, Still unclear, Who prepares what.'),
  t('Personal', 'Voice journal', 'general', 'Sections: What happened, How I felt, What I learned, Tomorrow. Write in the first person.'),
  t('Personal', 'Podcast or video notes', 'lecture', 'Sections: Guest and topic, Key ideas, Memorable quotes (exact words), Resources mentioned.'),
];

export const LIBRARY_CATEGORIES = [...new Set(TEMPLATE_LIBRARY.map((x) => x.category))];
