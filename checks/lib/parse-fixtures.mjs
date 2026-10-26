// Text items for the parse check, written by hand for invented people: what a reader would give the parser.
// A line is one or more items at one height; width is 5 pt a letter, the body is 10 pt, and a bold item has a Bold font.
// Nothing here is a real person: the names, firms and numbers are made up.

const item = (x, y, text, bold = false, size = 10) => ({ text, x, y, width: text.length * 5, height: size, fontName: bold ? 'Sans-Bold' : 'Sans', hasEOL: false });
// [[x, text, bold?], ...] on one line at height y; the last item ends it
export const line = (y, parts, page = 1) => parts.map(([x, text, bold], i) => ({ ...item(x, y, text, bold, bold ? 12 : 10), page, hasEOL: i === parts.length - 1 }));
// consecutive lines from y downwards, 14 pt apart, with a bigger gap where a null is; each row is [[dx from x0, text, bold?], ...]
export function flow(x0, y0, rows){
  let y = y0;
  return rows.flatMap(r => { if (r === null){ y -= 10; return []; } const out = [line(y, r.map(([dx, ...rest]) => [x0 + dx, ...rest]))]; y -= 14; return out; });
}
const one = text => [[0, text]];

// one column: a name, contact, a summary, three jobs, education, skills and a section nothing reads
export const oneColumn = flow(72, 760, [
  [[0, 'Jane Q. Sample', true]],
  [[0, 'jane.sample@example.com'], [200, '(555) 010-0100'], [330, 'Springfield, IL']],
  [[0, 'www.example.com/janesample']],
  one('Mechanical engineer who builds dosing devices for clinical teams.'),
  [[0, 'WORK EXPERIENCE', true]],
  [[0, 'Northgate Dosing Systems', true], [360, 'Mar 2021 – Present']],
  one('Mechanical Design Engineer'),
  one('• Led the redesign of the inhaler dose counter from sketch to production.'),
  one('• Cut the part count of the dosing pump by a third.'),
  null,
  [[0, 'Helix Diagnostics', true], [360, '2018 – 2021']],
  one('Product Development Engineer'),
  one('• Ran the tolerance study for a disposable cartridge across three suppliers.'),
  null,
  [[0, 'Atelier Lumen', true], [360, 'Jun 2015 – Aug 2018']],
  one('Test Technician'),
  one('• Built the fixtures for the flow tests.'),
  one('• Wrote the work instructions for the bench.'),
  null,
  [[0, 'EDUCATION', true]],
  [[0, 'Lakeside State University', true], [360, '2010 – 2014']],
  one('Bachelor of Science in Mechanical Engineering'),
  one('GPA: 3.8'),
  null,
  [[0, 'SKILLS', true]],
  one('CAD: SolidWorks, Fusion 360'),
  one('Fabrication: 3D printing, CNC machining'),
  null,
  [[0, 'REFERENCES', true]],
  one('Available on request from the director'),
]).flat();
export const oneColumnExpected = {
  basics: { name: 'Jane Q. Sample', email: 'jane.sample@example.com', phone: '(555) 010-0100', url: 'www.example.com/janesample',
    summary: 'Mechanical engineer who builds dosing devices for clinical teams.', location: { city: 'Springfield', region: 'IL' } },
  work: [
    { name: 'Northgate Dosing Systems', position: 'Mechanical Design Engineer', startDate: '2021-03',
      highlights: ['Led the redesign of the inhaler dose counter from sketch to production.', 'Cut the part count of the dosing pump by a third.'] },
    { name: 'Helix Diagnostics', position: 'Product Development Engineer', startDate: '2018', endDate: '2021',
      highlights: ['Ran the tolerance study for a disposable cartridge across three suppliers.'] },
    { name: 'Atelier Lumen', position: 'Test Technician', startDate: '2015-06', endDate: '2018-08',
      highlights: ['Built the fixtures for the flow tests.', 'Wrote the work instructions for the bench.'] },
  ],
  education: [{ institution: 'Lakeside State University', studyType: 'Bachelor of Science in Mechanical Engineering', score: '3.8', startDate: '2010', endDate: '2014' }],
  skills: [{ name: 'CAD', keywords: ['SolidWorks', 'Fusion 360'] }, { name: 'Fabrication', keywords: ['3D printing', 'CNC machining'] }],
};

// two columns, as a reader that writes the page row by row gives them: a header across the top, a sidebar
// (skills, education) at x 36 and the experience at x 200, every line of a column ended by itself
const row = lines => lines.sort((a, b) => b[0].y - a[0].y || a[0].x - b[0].x).flat();
export const twoColumns = row([
  ...flow(36, 760, [
    [[0, 'Jane Q. Sample', true]],
    [[0, 'jane.sample@example.com'], [154, '(555) 010-0100'], [284, 'Springfield, IL']],
    [[0, 'www.example.com/janesample']],
    one('Mechanical engineer who builds dosing devices for clinical teams.'),
  ]),
  ...flow(36, 690, [
    [[0, 'SKILLS', true]],
    one('CAD: SolidWorks, Fusion 360'),
    one('Fabrication: 3D printing'),
    null,
    [[0, 'EDUCATION', true]],
    one('Lakeside State University'),
    one('2010 – 2014'),
    one('Bachelor of Science'),
    one('GPA: 3.8'),
  ]),
  ...flow(200, 690, [
    [[0, 'WORK EXPERIENCE', true]],
    [[0, 'Northgate Dosing Systems', true], [190, 'Mar 2021 – Present']],
    one('Mechanical Design Engineer'),
    one('• Led the redesign of the inhaler dose counter from sketch to production.'),
    one('• Cut the part count of the dosing pump by a third.'),
    null,
    [[0, 'Helix Diagnostics', true], [190, '2018 – 2021']],
    one('Product Development Engineer'),
    one('• Ran the tolerance study for a disposable cartridge across three suppliers.'),
    null,
    [[0, 'Atelier Lumen', true], [190, 'Jun 2015 – Aug 2018']],
    one('Test Technician'),
    one('• Built the fixtures for the flow tests.'),
    one('• Wrote the work instructions for the bench.'),
  ]),
]);

// Hungarian headings, one not in bold capitals; the job titles are English because the catalogues hold none
export const hungarian = flow(72, 760, [
  [[0, 'Kovács Éva', true]],
  [[0, 'eva.kovacs@example.com'], [200, '(555) 010-0100'], [330, 'Szolnok, HU']],
  [[0, 'SZAKMAI TAPASZTALAT', true]],
  [[0, 'Dunai Műszer Kft.', true], [360, '2019. március – jelenleg']],
  one('Senior Engineer'),
  one('• Vezette az inhalátor adagolószámlálójának átalakítását.'),
  one('• Harmadával csökkentette az adagolószivattyú alkatrészeinek számát.'),
  null,
  [[0, 'Tisza Diagnosztika Zrt.', true], [360, '2016. szeptember – 2019. február']],
  one('Product Technician'),
  one('• Elvégezte a tűréselemzést három beszállítóval.'),
  null,
  [[0, 'Tanulmányok']],
  [[0, 'Budai Műszaki Egyetem', true], [360, '2010 – 2014']],
  one('Gépészmérnök BSc'),
  null,
  [[0, 'Készségek']],
  one('CAD: SolidWorks, Fusion 360'),
]).flat();

// German headings and a German date
export const german = flow(72, 760, [
  [[0, 'Anna Beispiel', true]],
  [[0, 'anna.beispiel@example.com']],
  [[0, 'Werdegang']],
  [[0, 'Rheinwerk Messtechnik GmbH', true], [360, 'März 2020 – heute']],
  one('Design Engineer'),
  one('• Entwarf die Messkammer für das neue Dosiergerät.'),
]).flat();

// ---- the cases that went wrong before: each is here because a simpler rule got it wrong ----

// a header and one job: name, email, a heading, a company with its date, the title and a bullet
const small = (heading, company, dateAt, date, title, bullet, bold = true) => flow(72, 760, [
  [[0, 'Anna Beispiel', true]],
  one('anna.beispiel@example.com'),
  [[0, heading, bold]],
  [[0, company, true], ...(dateAt ? [[dateAt, date]] : [])],
  ...(dateAt ? [] : [one(date)]),
  one(title),
  one(bullet),
]).flat();
// "Mai" is a month in German, and also the start of a company's name
export const maier = small('Werdegang', 'Maier Messtechnik GmbH', 0, '2020 – 2022', 'Design Engineer', '• Entwarf die Messkammer für das neue Dosiergerät.', false);
// a capitalised month and "present" in Hungarian
export const capitals = small('Tapasztalat', 'Dunai Műszer Kft.', 360, 'Március 2019 – Jelenleg', 'Senior Engineer', '• Vezette az inhalátor adagolószámlálójának átalakítását.', false);

// "Springfield" holds a season, "Representative" holds "present", "Doctor" holds a month, and three bullets open alike
export const lookalikes = flow(72, 760, [
  [[0, 'Jane Q. Sample', true]],
  one('jane.sample@example.com'),
  [[0, 'WORK EXPERIENCE', true]],
  [[0, 'Springfield Robotics', true]],
  one('Sales Representative'),
  one('2018 – 2020'),
  one('• Developed and maintained the test bench for the flow rig.'),
  one('• Developed and maintained the fixtures for the dose counter.'),
  one('• Developed and maintained the work instructions for the bench.'),
  null,
  [[0, 'EDUCATION', true]],
  [[0, 'Lakeside State University', true]],
  one('Doctor of Philosophy'),
  one('2010 – 2014'),
  null,
  [[0, 'REFERENCES', true]],
  one('Ask Jane about Lakeside State University'),
]).flat();
export const lookalikesExpected = {
  basics: { name: 'Jane Q. Sample', email: 'jane.sample@example.com' },
  work: [{ name: 'Springfield Robotics', position: 'Sales Representative', startDate: '2018', endDate: '2020',
    highlights: ['Developed and maintained the test bench for the flow rig.', 'Developed and maintained the fixtures for the dose counter.', 'Developed and maintained the work instructions for the bench.'] }],
  education: [{ institution: 'Lakeside State University', startDate: '2010', endDate: '2014' }],
};

// one column whose dates stand alone on lines at x 350, with bullets too short to reach them
export const datesAlone = flow(72, 760, [
  [[0, 'Jane Q. Sample', true]],
  one('jane.sample@example.com'),
  [[0, 'WORK EXPERIENCE', true]],
  [[0, 'Northgate Dosing Systems', true]],
  one('Mechanical Design Engineer'),
  [[278, 'Mar 2021 – Present']],
  one('• Led the dose counter redesign.'),
  one('• Cut the pump part count.'),
  null,
  [[0, 'Helix Diagnostics', true]],
  one('Product Development Engineer'),
  [[278, '2018 – 2021']],
  one('• Ran the tolerance study.'),
  null,
  [[0, 'Atelier Lumen', true]],
  one('Test Technician'),
  [[278, '2015 – 2018']],
  one('• Built the flow fixtures.'),
]).flat();
export const datesAloneWork = [
  { name: 'Northgate Dosing Systems', position: 'Mechanical Design Engineer', startDate: '2021-03', highlights: ['Led the dose counter redesign.', 'Cut the pump part count.'] },
  { name: 'Helix Diagnostics', position: 'Product Development Engineer', startDate: '2018', endDate: '2021', highlights: ['Ran the tolerance study.'] },
  { name: 'Atelier Lumen', position: 'Test Technician', startDate: '2015', endDate: '2018', highlights: ['Built the flow fixtures.'] },
];

// short columns: the header's two wide lines are a sixth of all the lines
const sidebar = (y, x = 36) => flow(x, y, [
  [[0, 'SKILLS', true]], one('CAD: SolidWorks, Fusion 360'), one('Fabrication: 3D printing'), one('Testing: DFM, FEA'),
]);
const main = (y, x = 200) => flow(x, y, [
  [[0, 'WORK EXPERIENCE', true]],
  [[0, 'Northgate Dosing Systems', true], [190, 'Mar 2021 – Present']],
  one('Mechanical Design Engineer'),
  one('• Led the redesign of the inhaler dose counter.'),
]);
export const shortColumns = row([
  ...flow(36, 760, [
    [[0, 'Jane Q. Sample', true]],
    [[0, 'jane.sample@example.com'], [154, '(555) 010-0100'], [284, 'Springfield, IL']],
    [[0, 'www.example.com/janesample']],
    one('Mechanical engineer who builds dosing devices for clinical teams.'),
  ]),
  ...sidebar(690), ...main(690),
]);
// a centred name and email, the first at x 230, inside the right column's x range
export const centredOverColumns = row([
  line(760, [[230, 'Jane Q. Sample', true]]), line(746, [[215, 'jane.sample@example.com']]),
  ...sidebar(716), ...main(716),
]);
export const shortColumnsWork = [{ name: 'Northgate Dosing Systems', startDate: '2021-03', position: 'Mechanical Design Engineer', highlights: ['Led the redesign of the inhaler dose counter.'] }];
export const shortColumnsSkills = [{ name: 'CAD', keywords: ['SolidWorks', 'Fusion 360'] }, { name: 'Fabrication', keywords: ['3D printing'] }, { name: 'Testing', keywords: ['DFM', 'FEA'] }];

// an empty line inside a section (a reader gives these)
export const withBlankLines = (() => {
  const at = F => F.findIndex(i => i.text === 'Helix Diagnostics');
  const blank = { text: '', x: 72, y: 500, width: 0, height: 10, fontName: 'Sans', hasEOL: true };
  const i = at(oneColumn);
  return [...oneColumn.slice(0, i), blank, { ...blank }, ...oneColumn.slice(i)];
})();
// a name with accents, not in bold or capitals
export const accentedName = flow(72, 760, [one('Éva Kovács'), one('eva.kovacs@example.com')]).flat();
// a heading that starts with a capital that is not ASCII, not in bold
export const capitalHeading = flow(72, 760, [
  [[0, 'Éva Kovács', true]],
  one('eva.kovacs@example.com'),
  one('Önéletrajz'),
  [[0, 'Northgate Dosing Systems', true], [360, '2015 – 2018']],
  one('Test Technician'),
  one('• Built the fixtures for the flow tests.'),
]).flat();

// one column whose jobs each have a place alone on a line at x 380, with bullets too short to reach it
export const placesAlone = flow(72, 760, [
  [[0, 'Jane Q. Sample', true]],
  one('jane.sample@example.com'),
  [[0, 'WORK EXPERIENCE', true]],
  [[0, 'Northgate Dosing Systems', true], [250, 'Mar 2021 – Present']],
  [[308, 'Springfield, IL']],
  one('Mechanical Design Engineer'),
  one('• Led the dose counter redesign.'),
  null,
  [[0, 'Helix Diagnostics', true], [250, '2018 – 2021']],
  [[308, 'Dayton, OH']],
  one('Product Development Engineer'),
  one('• Ran the tolerance study.'),
  null,
  [[0, 'Atelier Lumen', true], [250, '2015 – 2018']],
  [[308, 'Austin, TX']],
  one('Test Technician'),
  one('• Built the flow fixtures.'),
]).flat();
export const placesAloneWork = [
  { name: 'Northgate Dosing Systems', position: 'Mechanical Design Engineer', startDate: '2021-03', highlights: ['Led the dose counter redesign.'] },
  { name: 'Helix Diagnostics', position: 'Product Development Engineer', startDate: '2018', endDate: '2021', highlights: ['Ran the tolerance study.'] },
  { name: 'Atelier Lumen', position: 'Test Technician', startDate: '2015', endDate: '2018', highlights: ['Built the flow fixtures.'] },
];

// columns whose lines start at varied x: the right column at 200, 203, 204, 206, 207, 209
const at = (dx, ...rest) => [[dx, ...rest]];
export const variedStarts = row([
  ...flow(36, 760, [[[0, 'Jane Q. Sample', true]], one('jane.sample@example.com')]),
  ...sidebar(720),
  ...(() => {
    let y = 720;
    const out = [];
    for (const r of [
      at(0, 'WORK EXPERIENCE', true), [[3, 'Northgate Dosing Systems', true], [190, 'Mar 2021 – Present']], at(4, 'Mechanical Design Engineer'),
      at(6, '• Led the redesign of the inhaler dose counter.'), at(7, '• Cut the part count of the dosing pump.'), null,
      [[9, 'Helix Diagnostics', true], [190, '2018 – 2021']], at(0, 'Product Development Engineer'), at(3, '• Ran the tolerance study.'), at(4, '• Wrote the test report.'),
    ]){ if (r === null){ y -= 10; continue; } out.push(line(y, r.map(([dx, ...rest]) => [200 + dx, ...rest]))); y -= 14; }
    return out;
  })(),
]);
export const variedStartsWork = [
  { name: 'Northgate Dosing Systems', position: 'Mechanical Design Engineer', startDate: '2021-03', highlights: ['Led the redesign of the inhaler dose counter.', 'Cut the part count of the dosing pump.'] },
  { name: 'Helix Diagnostics', position: 'Product Development Engineer', startDate: '2018', endDate: '2021', highlights: ['Ran the tolerance study.', 'Wrote the test report.'] },
];

// four header lines at the left column's x, two of them wide, over a one-line sidebar and a three-line main column
export const headerOverShort = row([
  ...flow(36, 760, [
    [[0, 'Jane Q. Sample', true]],
    [[0, 'jane.sample@example.com'], [154, '(555) 010-0100'], [284, 'Springfield, IL']],
    [[0, 'www.example.com/janesample']],
    one('Mechanical engineer who builds dosing devices for clinical teams.'),
  ]),
  ...flow(36, 690, [[[0, 'SKILLS', true]], one('CAD: SolidWorks')]),
  ...flow(200, 690, [
    [[0, 'WORK EXPERIENCE', true]],
    [[0, 'Northgate Dosing Systems', true], [190, 'Mar 2021 – Present']],
    one('Mechanical Design Engineer'),
  ]),
]);

// two bullets in one item
export const twoBullets = small('WORK EXPERIENCE', 'Northgate Dosing Systems', 360, '2018 – 2021', 'Test Technician', '• Ran the study • Wrote the report');

// a header band over two columns whose rows never meet (the sidebar sits 7 pt lower), so a guess does not trust them
export const unpairedColumns = row([
  ...flow(36, 760, [
    [[0, 'Jane Q. Sample', true]],
    [[0, 'jane.sample@example.com'], [154, '(555) 010-0100'], [284, 'Springfield, IL']],
    [[0, 'www.example.com/janesample']],
    one('Mechanical engineer who builds dosing devices for clinical teams.'),
  ]),
  ...sidebar(683), ...main(690),
]);
export const unpairedLayout = [{ page: 1, headerBottom: 715, split: 150 }];

// the same columns the other way round: the main text at the left, the sidebar at the right, under a header
export const rightSidebar = row([
  ...flow(36, 760, [
    [[0, 'Jane Q. Sample', true]],
    [[0, 'jane.sample@example.com'], [154, '(555) 010-0100'], [284, 'Springfield, IL']],
    [[0, 'www.example.com/janesample']],
    one('Mechanical engineer who builds dosing devices for clinical teams.'),
  ]),
  ...main(690, 36), ...sidebar(690, 420),
]);

// a header whose three lines start at the right column's x, over two columns
export const headerAtColumn = row([
  ...flow(231, 760, [[[0, 'Jane Q. Sample', true]], one('jane.sample@example.com'), one('(555) 010-0100')]),
  ...sidebar(690), ...main(690),
]);

// one column with indented lines, a bit more than 30 pt in
export const indented = flow(72, 760, [
  [[0, 'Jane Q. Sample', true]], one('jane.sample@example.com'), [[0, 'WORK EXPERIENCE', true]],
  [[0, 'Northgate Dosing Systems', true], [288, 'Mar 2021 – Present']], one('Mechanical Design Engineer'),
  [[40, '– cut the part count']], [[40, '– three suppliers']], [[40, '– work instructions']], [[40, '– fixtures']],
  [[0, 'Helix Diagnostics', true], [288, '2018 – 2021']], one('Product Development Engineer'),
  [[40, '– tolerance study']], [[40, '– bench setup']], [[40, '– cartridge']],
]).flat();

// a bullet that is its own item, one that wraps, two in one item, and a glyph the parser does not know
export const bulletsMixed = flow(72, 760, [
  [[0, 'Jane Q. Sample', true]], one('jane.sample@example.com'), [[0, 'WORK EXPERIENCE', true]],
  [[0, 'Acme Works', true], [360, '2019 – 2021']], one('Test Technician'),
  [[0, '•'], [14, 'Built the fixtures for the flow tests and wrote']], one('  the instructions for the bench that went with them.'),
  one('• Ran the study • Wrote the report'), one('◦ Odd glyph bullet kept as text'),
]).flat();

// a resume with no dates on the jobs, one with no name, and one whose lines mostly go nowhere
export const undated = flow(72, 760, [
  [[0, 'Jane Q. Sample', true]], one('jane.sample@example.com'), [[0, 'WORK EXPERIENCE', true]],
  [[0, 'Northgate Dosing Systems', true]], one('Mechanical Design Engineer'), one('• Led the dose counter redesign.'), null,
  [[0, 'Helix Diagnostics', true]], one('Product Development Engineer'), one('• Ran the tolerance study.'),
]).flat();
export const noName = flow(72, 760, [one('(555) 010-0100'), one('Springfield, IL'), [[0, 'WORK EXPERIENCE', true]],
  [[0, 'Northgate Dosing Systems', true], [360, '2018 – 2021']], one('Test Technician'), one('• Built the flow fixtures.')]).flat();
export const manyLeftovers = flow(72, 760, [
  [[0, 'Jane Q. Sample', true]], one('jane.sample@example.com'), [[0, 'HOBBIES', true]],
  one('Chess'), one('Cycling'), one('Choir'), one('Gardening'), one('Sailing'), one('Pottery'),
]).flat();
