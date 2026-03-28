const schemas = require('./schemas');

describe('Zod enum schemas', () => {
  it('ProjectStatus accepts valid values', () => {
    expect(schemas.ProjectStatus.parse('active')).toBe('active');
    expect(schemas.ProjectStatus.parse('completed')).toBe('completed');
    expect(schemas.ProjectStatus.parse('archived')).toBe('archived');
  });

  it('ProjectStatus rejects invalid values', () => {
    expect(() => schemas.ProjectStatus.parse('banana')).toThrow();
    expect(() => schemas.ProjectStatus.parse('')).toThrow();
    expect(() => schemas.ProjectStatus.parse(123)).toThrow();
  });

  it('TaskStatus accepts valid values', () => {
    for (const v of ['todo', 'in_progress', 'done']) {
      expect(schemas.TaskStatus.parse(v)).toBe(v);
    }
  });

  it('CommentTargetType accepts valid values', () => {
    for (const v of ['group', 'project', 'task', 'announcement']) {
      expect(schemas.CommentTargetType.parse(v)).toBe(v);
    }
  });

  it('ShoppingItemType accepts valid values', () => {
    expect(schemas.ShoppingItemType.parse('product')).toBe('product');
    expect(schemas.ShoppingItemType.parse('cost')).toBe('cost');
  });
});

describe('groupCreate schema', () => {
  it('accepts valid group', () => {
    const result = schemas.groupCreate.parse({ name: 'Test Group' });
    expect(result.name).toBe('Test Group');
  });

  it('strips HTML from name', () => {
    const result = schemas.groupCreate.parse({ name: '<b>Bold</b> Group' });
    expect(result.name).toBe('Bold Group');
  });

  it('rejects empty name', () => {
    expect(() => schemas.groupCreate.parse({ name: '' })).toThrow();
  });

  it('rejects name with only HTML tags', () => {
    expect(() => schemas.groupCreate.parse({ name: '<br><br>' })).toThrow();
  });

  it('accepts optional description', () => {
    const result = schemas.groupCreate.parse({ name: 'Test', description: '<p>Hello</p>' });
    expect(result.description).toBe('<p>Hello</p>');
  });

  it('accepts optional mattermostChannel URL', () => {
    const result = schemas.groupCreate.parse({
      name: 'Test',
      mattermostChannel: 'https://mattermost.example.com/channel',
    });
    expect(result.mattermostChannel).toBe('https://mattermost.example.com/channel');
  });

  it('rejects invalid mattermostChannel URL', () => {
    expect(() => schemas.groupCreate.parse({
      name: 'Test',
      mattermostChannel: 'ftp://bad.com',
    })).toThrow();
  });

  it('accepts null mattermostChannel', () => {
    const result = schemas.groupCreate.parse({ name: 'Test', mattermostChannel: null });
    expect(result.mattermostChannel).toBeNull();
  });
});

describe('groupUpdate schema', () => {
  it('accepts partial update', () => {
    const result = schemas.groupUpdate.parse({ name: 'New Name' });
    expect(result.name).toBe('New Name');
  });

  it('accepts order update', () => {
    const result = schemas.groupUpdate.parse({ order: 5 });
    expect(result.order).toBe(5);
  });

  it('rejects empty update', () => {
    expect(() => schemas.groupUpdate.parse({})).toThrow();
  });
});

describe('projectCreate schema', () => {
  const validProject = {
    groupId: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Project',
  };

  it('accepts minimal valid project', () => {
    const result = schemas.projectCreate.parse(validProject);
    expect(result.name).toBe('Test Project');
    expect(result.groupId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects invalid groupId', () => {
    expect(() => schemas.projectCreate.parse({ ...validProject, groupId: 'not-a-uuid' })).toThrow();
  });

  it('accepts valid tier', () => {
    const result = schemas.projectCreate.parse({ ...validProject, tier: 'mvp' });
    expect(result.tier).toBe('mvp');
  });

  it('rejects invalid tier', () => {
    expect(() => schemas.projectCreate.parse({ ...validProject, tier: 'extreme' })).toThrow();
  });

  it('accepts valid joinType', () => {
    const result = schemas.projectCreate.parse({ ...validProject, joinType: 'open' });
    expect(result.joinType).toBe('open');
  });

  it('rejects invalid joinType', () => {
    expect(() => schemas.projectCreate.parse({ ...validProject, joinType: 'at_get_together' })).toThrow();
  });
});

describe('taskCreate schema', () => {
  const validTask = {
    projectId: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Fix the thing',
  };

  it('accepts minimal valid task', () => {
    const result = schemas.taskCreate.parse(validTask);
    expect(result.name).toBe('Fix the thing');
  });

  it('coerces deadline string to Date', () => {
    const result = schemas.taskCreate.parse({ ...validTask, deadline: '2026-04-15' });
    expect(result.deadline).toBeInstanceOf(Date);
  });

  it('accepts null deadline', () => {
    const result = schemas.taskCreate.parse({ ...validTask, deadline: null });
    expect(result.deadline).toBeNull();
  });
});

describe('taskUpdate schema', () => {
  it('accepts status update', () => {
    const result = schemas.taskUpdate.parse({ status: 'done' });
    expect(result.status).toBe('done');
  });

  it('rejects invalid status', () => {
    expect(() => schemas.taskUpdate.parse({ status: 'banana' })).toThrow();
  });
});

describe('commentCreate schema', () => {
  const valid = {
    targetType: 'project',
    targetId: '550e8400-e29b-41d4-a716-446655440000',
    authorName: 'Rosa',
    body: 'This is a comment',
  };

  it('accepts valid comment', () => {
    const result = schemas.commentCreate.parse(valid);
    expect(result.authorName).toBe('Rosa');
  });

  it('rejects short body', () => {
    expect(() => schemas.commentCreate.parse({ ...valid, body: 'x' })).toThrow();
  });

  it('rejects body over 2000 chars', () => {
    expect(() => schemas.commentCreate.parse({ ...valid, body: 'x'.repeat(2001) })).toThrow();
  });

  it('rejects invalid targetType', () => {
    expect(() => schemas.commentCreate.parse({ ...valid, targetType: 'invalid' })).toThrow();
  });

  it('strips HTML from authorName', () => {
    const result = schemas.commentCreate.parse({ ...valid, authorName: '<b>Rosa</b>' });
    expect(result.authorName).toBe('Rosa');
  });
});

describe('shoppingItemCreate schema', () => {
  const valid = {
    projectId: '550e8400-e29b-41d4-a716-446655440000',
    type: 'product',
    name: 'Screws',
  };

  it('accepts valid product item', () => {
    const result = schemas.shoppingItemCreate.parse(valid);
    expect(result.type).toBe('product');
    expect(result.quantity).toBe(1); // default
  });

  it('accepts valid cost item', () => {
    const result = schemas.shoppingItemCreate.parse({ ...valid, type: 'cost', amount: 50.00 });
    expect(result.type).toBe('cost');
    expect(result.amount).toBe(50.00);
  });

  it('rejects negative price', () => {
    expect(() => schemas.shoppingItemCreate.parse({ ...valid, pricePerItem: -5 })).toThrow();
  });

  it('rejects quantity over max', () => {
    expect(() => schemas.shoppingItemCreate.parse({ ...valid, quantity: 100000 })).toThrow();
  });

  it('rejects invalid link', () => {
    expect(() => schemas.shoppingItemCreate.parse({ ...valid, link: 'javascript:alert(1)' })).toThrow();
  });

  it('accepts valid http link', () => {
    const result = schemas.shoppingItemCreate.parse({ ...valid, link: 'https://shop.example.com/item' });
    expect(result.link).toBe('https://shop.example.com/item');
  });
});

describe('announcementCreate schema', () => {
  it('accepts valid announcement', () => {
    const result = schemas.announcementCreate.parse({ title: 'Hello', body: '<p>World</p>' });
    expect(result.title).toBe('Hello');
    expect(result.pinned).toBe(false); // default
  });

  it('rejects empty body', () => {
    expect(() => schemas.announcementCreate.parse({ title: 'Hello', body: '' })).toThrow();
  });
});

describe('reportCreate schema', () => {
  it('accepts valid report', () => {
    const result = schemas.reportCreate.parse({
      description: 'Something broke',
      reporterName: 'Tom',
    });
    expect(result.description).toBe('Something broke');
  });

  it('rejects screenshot without data:image/ prefix', () => {
    expect(() => schemas.reportCreate.parse({
      description: 'Bug',
      reporterName: 'Tom',
      screenshotData: 'not-a-data-url',
    })).toThrow();
  });
});

describe('uuid schema', () => {
  it('accepts valid UUID', () => {
    expect(schemas.uuid.parse('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects invalid UUID', () => {
    expect(() => schemas.uuid.parse('not-a-uuid')).toThrow();
  });
});
