BEGIN;

DO $$
BEGIN
  IF current_database() <> 'careerconnect_qa' THEN
    RAISE EXCEPTION 'Refusing to seed Toolkit content into database %. Expected careerconnect_qa.', current_database();
  END IF;
END $$;

WITH category AS (
  SELECT id
  FROM toolkit_categories
  WHERE slug = 'find-your-direction'
)
INSERT INTO toolkit_resources (
  category_id,
  slug,
  title,
  description,
  resource_type,
  reading_time_minutes,
  preview_body,
  what_you_will_learn,
  content_blocks,
  status,
  published_at
)
SELECT
  category.id,
  'choosing-a-credible-it-career-direction',
  'Choosing a Credible IT Career Direction',
  'A practical guide for choosing an IT direction that fits your strengths, current readiness, and next career conversation.',
  'guide',
  7,
  'A credible IT career direction is not chosen by copying someone else''s path. It starts with understanding what you can already show, what kind of work gives you energy, and which next step is realistic enough to explain with confidence. This guide helps you narrow broad interest into a clearer direction without treating CareerConnect as technical training, certification training, or placement support.',
  jsonb_build_array(
    'How to separate interest from readiness when choosing an IT direction',
    'How to compare first-role, lateral-move, and step-up options',
    'How to choose a direction you can explain honestly in a career conversation',
    'When Career Guidance can help you turn uncertainty into a focused next step'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'type', 'heading',
      'heading', 'Start with the direction question, not the job title'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'body', 'Many people begin by asking which IT role is best. A better first question is: which kind of work can I credibly move toward next? A fresher may be comparing support, cloud fundamentals, testing, or junior operations roles. An early-career professional may be deciding whether to deepen a technical path or move toward coordination, platform operations, automation, or delivery. An experienced professional may be preparing to step into broader ownership, service reliability, program delivery, or leadership.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'body', 'A credible direction sits at the intersection of three things: the work you understand, the strengths you can demonstrate, and the next conversation you can prepare for. It does not require pretending to be ready for everything. It does require knowing why the direction makes sense.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'heading', 'Look at your evidence'
    ),
    jsonb_build_object(
      'type', 'list',
      'items', jsonb_build_array(
        'Projects, labs, internships, support tickets, platform work, migrations, automations, documentation, or delivery responsibilities',
        'Problems you have helped investigate, simplify, coordinate, stabilize, or explain',
        'Tools and systems you have used enough to discuss with context, not just list as keywords',
        'Situations where you made decisions, followed a process, supported users, reduced risk, or improved clarity'
      )
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'body', 'For a fresher, evidence may come from academic work, personal projects, labs, internships, or disciplined self-study. For an experienced professional, evidence may come from production incidents, infrastructure ownership, stakeholder coordination, releases, governance, automation, or mentoring. The point is not to inflate the evidence. The point is to see what it can support.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'heading', 'Compare directions using practical questions'
    ),
    jsonb_build_object(
      'type', 'list',
      'items', jsonb_build_array(
        'What work would I be expected to explain in this role?',
        'Which parts of my current experience or projects already connect to it?',
        'What gaps are acceptable for an entry or transition point, and what gaps would block credibility?',
        'Can I explain why this direction fits my strengths without sounding generic?',
        'Would this direction move me toward work I actually want to do more often?'
      )
    ),
    jsonb_build_object(
      'type', 'callout',
      'heading', 'CareerConnect perspective',
      'body', 'CareerConnect does not choose a role for you or promise an outcome. Career Guidance can help you examine your background, compare realistic options, and prepare a direction you can explain clearly.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'heading', 'Choose one direction to test'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'body', 'You do not need to commit to a lifelong title. Pick one direction to test for the next phase of preparation. Write a short statement: I am exploring this direction because..., the evidence I can show is..., and the areas I still need to strengthen are.... If that statement feels impossible to write, the direction may be too broad, too early, or not connected enough to your strengths.'
    ),
    jsonb_build_object(
      'type', 'callout',
      'heading', 'When to ask for guidance',
      'body', 'If you are choosing between several IT paths, Career Guidance can help you narrow the direction and build a practical story around your current strengths.'
    )
  ),
  'published',
  NOW()
FROM category
ON CONFLICT (slug) DO UPDATE
SET
  category_id = EXCLUDED.category_id,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  resource_type = EXCLUDED.resource_type,
  reading_time_minutes = EXCLUDED.reading_time_minutes,
  preview_body = EXCLUDED.preview_body,
  what_you_will_learn = EXCLUDED.what_you_will_learn,
  content_blocks = EXCLUDED.content_blocks,
  status = EXCLUDED.status,
  published_at = COALESCE(toolkit_resources.published_at, EXCLUDED.published_at);

WITH category AS (
  SELECT id
  FROM toolkit_categories
  WHERE slug = 'position-your-strengths'
)
INSERT INTO toolkit_resources (
  category_id,
  slug,
  title,
  description,
  resource_type,
  reading_time_minutes,
  preview_body,
  what_you_will_learn,
  content_blocks,
  status,
  published_at
)
SELECT
  category.id,
  'turning-skills-and-projects-into-a-clear-career-story',
  'Turning Skills and Projects Into a Clear Career Story',
  'A guide for translating skills, projects, responsibilities, and impact into a focused IT career story.',
  'guide',
  8,
  'A list of tools is not a career story. A project title is not enough either. Career conversations become stronger when you can explain what the situation was, what you contributed, what decisions or trade-offs mattered, and what the work shows about your readiness. This guide helps you move from scattered experience to a clearer professional story.',
  jsonb_build_array(
    'How to turn tools and tasks into evidence of capability',
    'How to describe projects without exaggerating ownership',
    'How to connect technical work with business, user, team, or operational impact',
    'How Career Guidance can help refine your positioning'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'type', 'heading',
      'heading', 'Start with what the work proves'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'body', 'People often describe themselves by listing tools: Linux, networking, cloud, SQL, automation, monitoring, ticketing, project coordination, SAP, CI/CD, or reporting. Tools matter, but they do not explain your value by themselves. A stronger career story connects the tool to a problem, a responsibility, and a result.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'body', 'Instead of saying you worked on cloud operations, explain what you supported: provisioning, access, monitoring, incident response, cost awareness, deployments, documentation, or coordination. Instead of saying you used automation, explain what became faster, safer, more consistent, or easier to maintain.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'heading', 'Use a simple evidence structure'
    ),
    jsonb_build_object(
      'type', 'list',
      'items', jsonb_build_array(
        'Context: What was the environment, project, or problem?',
        'Responsibility: What part did you own, support, build, coordinate, or improve?',
        'Action: What did you actually do?',
        'Judgment: What decisions, constraints, or trade-offs mattered?',
        'Outcome: What changed, improved, stabilized, clarified, or became easier?'
      )
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'body', 'This structure works for freshers too. A lab, academic project, portfolio build, or internship can still show problem solving, disciplined learning, documentation, troubleshooting, or communication. The story must be honest about scope, but it should still make the learning and contribution visible.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'heading', 'Avoid the two common extremes'
    ),
    jsonb_build_object(
      'type', 'list',
      'items', jsonb_build_array(
        'Too vague: I handled infrastructure and supported users.',
        'Too inflated: I owned the complete platform strategy when you were part of a support or delivery team.',
        'Stronger: I supported access, monitoring, and incident follow-up for an internal platform, and I improved the handover checklist so recurring issues were easier to track.'
      )
    ),
    jsonb_build_object(
      'type', 'heading',
      'heading', 'Build a story around strengths, not just chronology'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'body', 'A career story is not a timeline of everything you have done. It is a focused explanation of the strengths you want the next conversation to notice. Those strengths might be troubleshooting, platform reliability, user communication, coordination, structured delivery, documentation, automation mindset, stakeholder handling, or leadership readiness.'
    ),
    jsonb_build_object(
      'type', 'callout',
      'heading', 'CareerConnect perspective',
      'body', 'Career Guidance can help you decide which strengths to lead with and how to connect them to the IT role direction you are exploring.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'heading', 'Turn one project into three proof points'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'body', 'Choose one project or responsibility and write three proof points: one technical, one collaboration or delivery-related, and one learning or judgment-related. This gives you more range in interviews and career conversations without inventing experience.'
    )
  ),
  'published',
  NOW()
FROM category
ON CONFLICT (slug) DO UPDATE
SET
  category_id = EXCLUDED.category_id,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  resource_type = EXCLUDED.resource_type,
  reading_time_minutes = EXCLUDED.reading_time_minutes,
  preview_body = EXCLUDED.preview_body,
  what_you_will_learn = EXCLUDED.what_you_will_learn,
  content_blocks = EXCLUDED.content_blocks,
  status = EXCLUDED.status,
  published_at = COALESCE(toolkit_resources.published_at, EXCLUDED.published_at);

WITH category AS (
  SELECT id
  FROM toolkit_categories
  WHERE slug = 'prepare-for-interviews'
)
INSERT INTO toolkit_resources (
  category_id,
  slug,
  title,
  description,
  resource_type,
  reading_time_minutes,
  preview_body,
  what_you_will_learn,
  content_blocks,
  status,
  published_at
)
SELECT
  category.id,
  'explaining-your-it-experience-with-confidence',
  'Explaining Your IT Experience With Confidence',
  'A guide for answering IT interview and career-conversation questions with clearer structure, evidence, and honesty.',
  'guide',
  9,
  'Confidence in an IT interview does not mean having a perfect answer for every technical question. It means explaining your experience clearly, showing how you think, and being honest about what you know, what you have done, and what you are ready to learn. This guide gives you a practical structure for discussing projects, decisions, impact, and readiness.',
  jsonb_build_array(
    'How to structure answers without sounding memorized',
    'How to explain projects, incidents, support work, or platform responsibilities',
    'How to discuss decisions, gaps, and learning honestly',
    'When Mock Interviews can help you practise career conversations'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'type', 'heading',
      'heading', 'Confidence comes from structure'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'body', 'Many candidates know the work but struggle to explain it. They answer too briefly, jump straight into tools, or describe tasks without showing thinking. A simple structure helps you slow down and make your experience easier to follow.'
    ),
    jsonb_build_object(
      'type', 'list',
      'items', jsonb_build_array(
        'Set the context: what was happening and why it mattered',
        'Explain your role: what you were responsible for',
        'Describe your action: what you did and how you approached it',
        'Share the impact: what changed, improved, or became clearer',
        'Reflect briefly: what you learned or would improve next time'
      )
    ),
    jsonb_build_object(
      'type', 'heading',
      'heading', 'Explain technical work through decisions'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'body', 'Interviewers often listen for how you think, not only which tool you used. If you worked on monitoring, explain what signals mattered. If you supported an incident, explain how you narrowed the issue. If you built a script, explain what risk or repetition it reduced. If you coordinated a release, explain how you managed dependencies and communication.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'heading', 'For freshers: make projects easier to trust'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'body', 'If you are entering IT, your projects may be smaller than production work. That is fine. Be clear about the scope. Explain what you built or configured, what problem you were trying to understand, what errors you faced, and what you changed after testing. A modest project explained well is stronger than a large claim you cannot discuss.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'heading', 'For experienced professionals: show readiness for the next level'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'body', 'If you are changing roles or stepping up, your answers should show more than task execution. Bring out ownership, prioritization, trade-offs, stakeholder communication, mentoring, risk awareness, service impact, and how you handled ambiguity. These details help the conversation move from what you did to how you operate.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'heading', 'Handle gaps without sounding defensive'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'body', 'You do not need to pretend every gap is closed. A stronger answer is: I have not owned that fully yet, but I have worked adjacent to it through..., I understand the basics of..., and the next area I am strengthening is.... This shows honesty and direction.'
    ),
    jsonb_build_object(
      'type', 'callout',
      'heading', 'CareerConnect perspective',
      'body', 'Mock Interviews can help you practise explaining your experience, decisions, impact, and readiness in a realistic conversation. They are preparation support, not a guarantee of interviews or outcomes.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'heading', 'Practise one answer three ways'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'body', 'Pick one project or responsibility. Practise a 30-second version, a two-minute version, and a deeper technical version. This helps you adapt to different interview styles without losing the core story.'
    )
  ),
  'published',
  NOW()
FROM category
ON CONFLICT (slug) DO UPDATE
SET
  category_id = EXCLUDED.category_id,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  resource_type = EXCLUDED.resource_type,
  reading_time_minutes = EXCLUDED.reading_time_minutes,
  preview_body = EXCLUDED.preview_body,
  what_you_will_learn = EXCLUDED.what_you_will_learn,
  content_blocks = EXCLUDED.content_blocks,
  status = EXCLUDED.status,
  published_at = COALESCE(toolkit_resources.published_at, EXCLUDED.published_at);

COMMIT;
