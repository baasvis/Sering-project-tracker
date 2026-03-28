const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function main() {
  // Groups
  const construction = await db.group.create({ data: { name: 'Construction', description: 'Building and renovation projects', order: 1 } });
  const operations   = await db.group.create({ data: { name: 'Operations',   description: 'Day-to-day running of locations', order: 2 } });
  const events       = await db.group.create({ data: { name: 'Events',       description: 'Dinners, markets, and special occasions', order: 3 } });
  const expansion    = await db.group.create({ data: { name: 'Expansion',    description: 'New locations and growth initiatives', order: 4 } });

  // Projects
  const terrace = await db.project.create({ data: {
    groupId: construction.id,
    name: 'Build terrace at Centraal',
    description: 'New outdoor seating area for Sering Centraal. Needs permits, materials, and volunteer build days.',
    contactPerson: 'Daan',
    tier: 'medium',
    joinType: 'open',
    status: 'active',
  }});

  const kitchen = await db.project.create({ data: {
    groupId: construction.id,
    name: 'Kitchen ventilation upgrade',
    description: 'Current ventilation is too loud and not up to standard. Getting quotes from contractors.',
    contactPerson: 'Sara',
    tier: 'mvp',
    joinType: 'contact',
    status: 'active',
  }});

  const tuesday = await db.project.create({ data: {
    groupId: events.id,
    name: 'Launch Tuesday dinners',
    description: 'Weekly community dinners every Tuesday at Sering West. Need menu planning, volunteer schedule, and promotion.',
    contactPerson: 'Lena',
    tier: 'mvp',
    joinType: 'open',
    status: 'active',
  }});

  const waste = await db.project.create({ data: {
    groupId: operations.id,
    name: 'Reduce food waste tracking',
    description: 'Set up a simple system to log daily food waste by category so we can see where to improve.',
    contactPerson: 'Tom',
    tier: 'medium',
    joinType: 'closed',
    status: 'active',
  }});

  const newLocation = await db.project.create({ data: {
    groupId: expansion.id,
    name: 'Sering Noord feasibility',
    description: 'Exploring a potential fourth location in Amsterdam Noord. Research phase.',
    contactPerson: 'Daan',
    tier: 'next_level',
    joinType: 'contact',
    status: 'active',
  }});

  const oldProject = await db.project.create({ data: {
    groupId: construction.id,
    name: 'Paint entrance hallway',
    description: 'Repainted the entrance at Sering West.',
    contactPerson: 'Rosa',
    tier: 'mvp',
    joinType: 'closed',
    status: 'completed',
  }});

  // Tasks — terrace
  await db.task.createMany({ data: [
    { projectId: terrace.id, name: 'Apply for building permit',   status: 'done',        assignee: 'Daan',   order: 1 },
    { projectId: terrace.id, name: 'Get materials quote',         status: 'done',        assignee: 'Sara',   order: 2 },
    { projectId: terrace.id, name: 'Order wood and screws',       status: 'in_progress', assignee: 'Tom',    deadline: new Date('2026-04-10'), order: 3 },
    { projectId: terrace.id, name: 'Organise build day volunteers', status: 'todo',      assignee: 'Lena',   deadline: new Date('2026-04-15'), order: 4 },
    { projectId: terrace.id, name: 'Build terrace frame',         status: 'todo',        order: 5 },
    { projectId: terrace.id, name: 'Sand and finish surface',     status: 'todo',        order: 6 },
  ]});

  // Tasks — kitchen ventilation
  await db.task.createMany({ data: [
    { projectId: kitchen.id, name: 'Get 3 contractor quotes',     status: 'in_progress', assignee: 'Sara',   order: 1 },
    { projectId: kitchen.id, name: 'Check noise regulations',     status: 'done',        assignee: 'Daan',   order: 2 },
    { projectId: kitchen.id, name: 'Choose contractor',           status: 'todo',        order: 3 },
    { projectId: kitchen.id, name: 'Schedule installation',       status: 'todo',        order: 4 },
  ]});

  // Tasks — tuesday dinners
  await db.task.createMany({ data: [
    { projectId: tuesday.id, name: 'Set recurring menu template', status: 'done',        assignee: 'Lena',   order: 1 },
    { projectId: tuesday.id, name: 'Recruit 4 regular volunteers', status: 'in_progress', assignee: 'Rosa',  order: 2 },
    { projectId: tuesday.id, name: 'Design flyer',                status: 'todo',        deadline: new Date('2026-04-01'), order: 3 },
    { projectId: tuesday.id, name: 'Post on Instagram + newsletter', status: 'todo',     order: 4 },
    { projectId: tuesday.id, name: 'First dinner test run',       status: 'todo',        deadline: new Date('2026-04-15'), order: 5 },
  ]});

  // Tasks — food waste
  await db.task.createMany({ data: [
    { projectId: waste.id, name: 'Design waste log sheet',        status: 'done',        assignee: 'Tom',    order: 1 },
    { projectId: waste.id, name: 'Train kitchen team on logging', status: 'todo',        order: 2 },
    { projectId: waste.id, name: 'Review first month of data',    status: 'todo',        deadline: new Date('2026-05-01'), order: 3 },
  ]});

  // Tasks — expansion
  await db.task.createMany({ data: [
    { projectId: newLocation.id, name: 'Map potential Noord locations', status: 'in_progress', assignee: 'Daan', order: 1 },
    { projectId: newLocation.id, name: 'Talk to Noord community groups', status: 'todo',       order: 2 },
    { projectId: newLocation.id, name: 'Financial feasibility estimate', status: 'todo',       order: 3 },
  ]});

  // Announcements
  await db.announcement.create({ data: {
    title: 'Terrace build day — April 20!',
    body: '<p>We\'re building the new terrace at Sering Centraal on <strong>Saturday April 20</strong>. All hands welcome — no experience needed. Bring work clothes. Food provided!</p>',
    authorEmail: 'daan@desering.org',
    pinned: true,
  }});

  await db.announcement.create({ data: {
    title: 'Tuesday dinners starting next month',
    body: '<p>Excited to announce we\'re launching weekly community dinners every Tuesday evening at Sering West. More details coming soon — follow the project for updates.</p>',
    authorEmail: 'daan@desering.org',
    pinned: false,
  }});

  await db.announcement.create({ data: {
    title: 'Welcome to the project tracker!',
    body: '<p>This is where we track everything happening across De Sering. Browse projects, follow progress, and leave comments. No login needed — just enter your name.</p>',
    authorEmail: 'daan@desering.org',
    pinned: false,
  }});

  // Comments
  await db.comment.create({ data: {
    targetType: 'project',
    targetId: terrace.id,
    authorName: 'Rosa',
    body: 'I can help on the build day! Will there be a sign-up sheet?',
  }});

  await db.comment.create({ data: {
    targetType: 'project',
    targetId: terrace.id,
    authorName: 'Volunteer Mike',
    body: 'Just saw the announcement — counting me in for April 20.',
  }});

  await db.comment.create({ data: {
    targetType: 'project',
    targetId: tuesday.id,
    authorName: 'Lena',
    body: 'Menu planning doc is in the shared drive. Let\'s align at the next get-together.',
  }});

  console.log('Seed complete.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
