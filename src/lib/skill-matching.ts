import { JOB_ROLES, type JobRole } from './job-roles';

/**
 * Skill names arrive from three places that never agree on wording: the LLM
 * extractor, the curated role dataset, and (eventually) the user. Everything is
 * funnelled through `normalizeSkill` before comparison so "Big-O Notation",
 * "big o notation" and "Big O" collapse to one key.
 */

/** Canonical form -> variants students/LLMs actually write. */
const SKILL_ALIASES: Record<string, string[]> = {
  'javascript': ['js', 'ecmascript', 'vanilla javascript'],
  'typescript': ['ts'],
  'python': ['python3', 'python programming'],
  'c programming': ['c', 'c language'],
  'object-oriented programming': ['oop', 'object oriented programming', 'object-oriented design'],
  'data structures': ['data structure', 'datastructures', 'adt', 'abstract data types'],
  'algorithms': ['algorithm', 'algorithm design', 'algorithmic thinking', 'big-o notation', 'big o notation', 'complexity analysis', 'asymptotic analysis', 'sorting algorithms', 'searching algorithms', 'recursion', 'dynamic programming', 'greedy algorithms', 'graph algorithms'],
  'sql': ['structured query language', 'sql queries', 'query language'],
  'databases': ['database', 'database systems', 'dbms', 'relational databases', 'database design', 'normalization', 'indexing', 'transactions'],
  'rest apis': ['rest', 'restful apis', 'api design', 'apis', 'web apis', 'http apis'],
  'git': ['version control', 'github', 'git version control'],
  'react': ['reactjs', 'react.js'],
  'node.js': ['node', 'nodejs', 'node js'],
  'html': ['html5', 'markup'],
  'css': ['css3', 'stylesheets', 'tailwind', 'tailwind css'],
  'machine learning': ['ml', 'supervised learning', 'unsupervised learning', 'classification', 'regression', 'model training'],
  'deep learning': ['neural networks', 'neural network', 'cnn', 'rnn', 'transformers', 'backpropagation'],
  'statistics': ['statistical analysis', 'stats', 'hypothesis testing', 'descriptive statistics', 'inferential statistics'],
  'probability': ['probability theory', 'bayesian', 'bayes theorem', 'random variables', 'distributions'],
  'linear algebra': ['matrices', 'matrix algebra', 'vectors', 'eigenvalues', 'vector spaces'],
  'calculus': ['differential calculus', 'integral calculus', 'derivatives', 'integrals'],
  'data visualization': ['data viz', 'visualization', 'charts', 'dashboards', 'plotting', 'tableau', 'power bi'],
  'operating systems': ['os', 'operating system', 'processes', 'threads', 'concurrency', 'scheduling', 'memory management', 'deadlock'],
  'computer networks': ['networking', 'computer networking', 'tcp/ip', 'osi model', 'network protocols'],
  'networking': ['computer networks', 'tcp/ip', 'network fundamentals'],
  'computer architecture': ['cpu architecture', 'assembly', 'assembly language', 'digital logic', 'processor design'],
  'security': ['cybersecurity', 'information security', 'infosec', 'network security', 'application security'],
  'cryptography': ['encryption', 'crypto', 'hashing', 'public key cryptography'],
  'cloud computing': ['cloud', 'aws', 'azure', 'gcp', 'google cloud', 'cloud platforms'],
  'docker': ['containers', 'containerization', 'kubernetes'],
  'ci/cd': ['continuous integration', 'continuous deployment', 'build pipelines', 'devops pipelines'],
  'linux': ['unix', 'bash', 'shell', 'command line'],
  'scripting': ['shell scripting', 'bash scripting', 'automation scripting'],
  'testing': ['unit testing', 'software testing', 'test automation', 'integration testing', 'qa'],
  'debugging': ['troubleshooting', 'error handling', 'fault diagnosis'],
  'agile': ['scrum', 'kanban', 'agile methodology', 'sprint planning'],
  'project management': ['program management', 'delivery management'],
  'communication': ['written communication', 'verbal communication', 'communication skills'],
  'problem solving': ['analytical thinking', 'problem-solving', 'critical thinking'],
  'critical thinking': ['analytical reasoning', 'logical reasoning'],
  'excel': ['spreadsheets', 'microsoft excel', 'google sheets'],
  'financial analysis': ['finance', 'financial modeling', 'financial modelling'],
  'accounting': ['bookkeeping', 'financial accounting', 'managerial accounting'],
  'economics': ['microeconomics', 'macroeconomics', 'economic theory'],
  'market research': ['marketing research', 'competitive analysis'],
  'business analysis': ['business analytics', 'requirements analysis'],
  'user research': ['ux research', 'user interviews', 'user testing'],
  'ui design': ['user interface design', 'interface design'],
  'visual design': ['graphic design', 'visual hierarchy'],
  'wireframing': ['wireframes', 'low-fidelity design'],
  'prototyping': ['prototypes', 'figma', 'interactive prototypes'],
  'usability testing': ['usability', 'heuristic evaluation'],
  'accessibility': ['a11y', 'wcag', 'inclusive design'],
  'responsive design': ['mobile-first design', 'adaptive design'],
  'technical writing': ['documentation', 'docs writing'],
  'research methods': ['research methodology', 'experimental design'],
  'data analysis': ['data analytics', 'analytics', 'exploratory data analysis'],
  'data modeling': ['schema design', 'entity relationship modeling', 'er diagrams'],
  'etl': ['data pipelines', 'extract transform load'],
  'distributed systems': ['distributed computing', 'microservices', 'system design'],
  'software development lifecycle': ['sdlc', 'software engineering process', 'software engineering'],
  'authentication': ['auth', 'authorization', 'oauth', 'access control'],
  'state management': ['redux', 'application state'],
  'mobile development': ['android', 'ios', 'react native', 'flutter', 'swift', 'kotlin'],
  'microcontrollers': ['arduino', 'raspberry pi', 'firmware'],
  'infrastructure as code': ['terraform', 'cloudformation', 'ansible'],
  'design systems': ['component libraries', 'style guides'],
  'risk assessment': ['risk management', 'risk analysis'],
  'requirements gathering': ['requirements elicitation', 'stakeholder interviews'],
  'process modeling': ['process mapping', 'bpmn', 'workflow design'],
  'stakeholder management': ['stakeholder communication'],
  'presentation skills': ['public speaking', 'presenting'],
  'consumer behavior': ['consumer psychology', 'buyer behaviour'],
  'supply chain': ['logistics', 'supply chain management'],
  'valuation': ['dcf', 'company valuation'],
  'product strategy': ['product management', 'product vision'],
  'roadmapping': ['product roadmap', 'roadmap planning'],
  'information architecture': ['content structure', 'ia'],
  'probability and statistics': ['probability & statistics'],
};

/** Lowercase, drop separators/punctuation, collapse whitespace. */
function clean(skill: string): string {
  return skill
    .toLowerCase()
    .trim()
    .replace(/[_/]/g, ' ')
    .replace(/[^a-z0-9+#.\- ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * cleaned form -> canonical, built once from SKILL_ALIASES.
 *
 * Canonical keys are indexed by their *cleaned* form, not their literal one.
 * Without that, any canonical containing a character `clean` strips — "ci/cd",
 * or the "&" in "probability & statistics" — becomes unreachable: the literal
 * "CI/CD" cleans to "ci cd" and misses the "ci/cd" entry, so a student whose
 * skill is the alias "Continuous Integration" resolves to "ci/cd" while the job
 * role's own "CI/CD" resolves to "ci cd", and the two never match.
 */
const CLEANED_TO_CANONICAL = new Map<string, string>();
for (const [canonical, variants] of Object.entries(SKILL_ALIASES)) {
  CLEANED_TO_CANONICAL.set(clean(canonical), canonical);
  for (const variant of variants) {
    CLEANED_TO_CANONICAL.set(clean(variant), canonical);
  }
}

/** Cleans a skill name, then resolves it to its canonical form. */
export function normalizeSkill(skill: string): string {
  const cleaned = clean(skill);

  if (CLEANED_TO_CANONICAL.has(cleaned)) return CLEANED_TO_CANONICAL.get(cleaned)!;

  // Retry without a trailing plural — "algorithms" vs "algorithm".
  const singular = cleaned.replace(/s$/, '');
  if (CLEANED_TO_CANONICAL.has(singular)) return CLEANED_TO_CANONICAL.get(singular)!;

  return cleaned;
}

/**
 * Two skills match when they normalize identically, or when one canonical form
 * fully contains the other as a whole word ("machine learning" vs "learning"
 * must NOT match, but "data structures" vs "data structures and algorithms"
 * should). The whole-word guard keeps that from becoming substring soup.
 */
function skillsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  // Require the shorter term to be at least two words, otherwise generic
  // single words ("design", "analysis") over-match many unrelated roles.
  if (!shorter.includes(' ')) return false;
  return new RegExp(`(^|\\s)${escapeRegExp(shorter)}(\\s|$)`).test(longer);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface RoleMatch {
  role: JobRole;
  matched_skills: string[];
  missing_skills: string[];
  match_percentage: number;
}

/**
 * Ranks every curated role against the student's accumulated skills.
 * Returns roles sorted by match strength; roles with zero overlap are dropped
 * unless the student has no recognised skills at all (in which case we show a
 * starter set so the screen is never empty).
 */
export function matchRolesToSkills(userSkills: string[], limit = 6, roles: JobRole[] = JOB_ROLES): RoleMatch[] {
  const normalizedUserSkills = [...new Set(userSkills.map(normalizeSkill))].filter(Boolean);

  const matches: RoleMatch[] = roles.map((role) => {
    const matched: string[] = [];
    const missing: string[] = [];

    for (const required of role.required_skills) {
      const normalizedRequired = normalizeSkill(required);
      const hit = normalizedUserSkills.some((userSkill) => skillsMatch(userSkill, normalizedRequired));
      if (hit) matched.push(required);
      else missing.push(required);
    }

    return {
      role,
      matched_skills: matched,
      missing_skills: missing,
      match_percentage: Math.round((matched.length / role.required_skills.length) * 100),
    };
  });

  const withOverlap = matches.filter((m) => m.matched_skills.length > 0);

  const ranked = (withOverlap.length > 0 ? withOverlap : matches).sort((a, b) => {
    if (b.match_percentage !== a.match_percentage) return b.match_percentage - a.match_percentage;
    // Tie-break on absolute matches so broader roles don't outrank deeper ones.
    return b.matched_skills.length - a.matched_skills.length;
  });

  return ranked.slice(0, limit);
}

/**
 * Skills that appear across the most near-miss roles — i.e. the highest-leverage
 * things to learn next. Only considers roles the student already partly matches.
 */
export function topSkillGaps(
  userSkills: string[],
  limit = 6,
  roles: JobRole[] = JOB_ROLES,
): { skill: string; unlocks: number }[] {
  const matches = matchRolesToSkills(userSkills, roles.length, roles).filter((m) => m.match_percentage > 0);
  const gapCounts = new Map<string, number>();

  for (const match of matches) {
    for (const missing of match.missing_skills) {
      gapCounts.set(missing, (gapCounts.get(missing) ?? 0) + 1);
    }
  }

  return [...gapCounts.entries()]
    .map(([skill, unlocks]) => ({ skill, unlocks }))
    .sort((a, b) => b.unlocks - a.unlocks)
    .slice(0, limit);
}
