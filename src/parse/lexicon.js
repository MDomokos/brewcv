// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/{group-lines-into-sections.ts,extract-resume-from-sections/extract-*.ts,extract-resume-from-sections/lib/common-features.ts}, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: the word lists gathered in one file
// The words the parser looks for: OpenResume's own English lists, gathered in one place. A section keyword
// is matched as a part of the lower-case section title.
export const ENGLISH = {
  sections: {
    work: ['work', 'experience', 'employment', 'history', 'job'],
    education: ['education'],
    project: ['project'],
    skills: ['skill'],
    summary: ['summary'],
    objective: ['objective'],
    courses: ['course'],
  },
  // what a short title that is not bold capitals must contain to be taken for one
  titleWords: ['experience', 'education', 'project', 'skill', 'job', 'course', 'extracurricular', 'objective', 'summary', 'award', 'honor'],
  jobTitles: ['Accountant', 'Administrator', 'Advisor', 'Agent', 'Analyst', 'Apprentice', 'Architect', 'Assistant', 'Associate', 'Auditor', 'Bartender', 'Biologist', 'Bookkeeper', 'Buyer', 'Carpenter', 'Cashier', 'CEO', 'Clerk', 'Co-op', 'Co-Founder', 'Consultant', 'Coordinator', 'CTO', 'Developer', 'Designer', 'Director', 'Driver', 'Editor', 'Electrician', 'Engineer', 'Extern', 'Founder', 'Freelancer', 'Head', 'Intern', 'Janitor', 'Journalist', 'Laborer', 'Lawyer', 'Lead', 'Manager', 'Mechanic', 'Member', 'Nurse', 'Officer', 'Operator', 'Operation', 'Photographer', 'President', 'Producer', 'Recruiter', 'Representative', 'Researcher', 'Sales', 'Server', 'Scientist', 'Specialist', 'Supervisor', 'Teacher', 'Technician', 'Trader', 'Trainee', 'Treasurer', 'Tutor', 'Vice', 'VP', 'Volunteer', 'Webmaster', 'Worker'],
  schools: ['College', 'University', 'Institute', 'School', 'Academy', 'BASIS', 'Magnet'],
  degrees: ['Associate', 'Bachelor', 'Master', 'PhD', 'Ph.'],
  // January first: the position is the month's number
  months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  seasons: ['Summer', 'Fall', 'Spring', 'Winter'],
  present: ['Present'],
};

// The English lists with the caller's words added to them (a Hungarian resume may still say "Education"),
// except the months, which a lexicon replaces: twelve names, January first.
export function withEnglish(extra = {}){
  const add = (a, b) => [...a, ...(b ?? [])];
  const lex = { months: extra.months ?? ENGLISH.months, sections: {} };
  for (const k of ['titleWords', 'jobTitles', 'schools', 'degrees', 'seasons', 'present']) lex[k] = add(ENGLISH[k], extra[k]);
  for (const k in ENGLISH.sections) lex.sections[k] = add(ENGLISH.sections[k], extra.sections?.[k]);
  return lex;
}
