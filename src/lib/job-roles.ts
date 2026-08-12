/**
 * Static curated job-role dataset (PRD §8).
 *
 * Deliberately NOT scraped from LinkedIn/job boards: live scraping is
 * ToS-restricted and is the most likely thing to fail in front of judges.
 * Roles span CS, data, design and business tracks so the roadmap produces
 * a sensible result regardless of the student's major.
 */

export interface JobRole {
  id: string;
  title: string;
  track: 'engineering' | 'data' | 'product' | 'business' | 'design';
  required_skills: string[];
  description: string;
}

export const JOB_ROLES: JobRole[] = [
  {
    id: 'junior-backend-developer',
    title: 'Junior Backend Developer',
    track: 'engineering',
    required_skills: ['Data Structures', 'Algorithms', 'SQL', 'REST APIs', 'Git', 'Node.js', 'Databases'],
    description: 'Entry-level role building and maintaining backend services and APIs.',
  },
  {
    id: 'junior-frontend-developer',
    title: 'Junior Frontend Developer',
    track: 'engineering',
    required_skills: ['JavaScript', 'HTML', 'CSS', 'React', 'Git', 'Responsive Design', 'REST APIs'],
    description: 'Builds user-facing web interfaces and connects them to backend services.',
  },
  {
    id: 'full-stack-developer',
    title: 'Full Stack Developer',
    track: 'engineering',
    required_skills: ['JavaScript', 'React', 'Node.js', 'SQL', 'REST APIs', 'Git', 'Data Structures', 'Authentication'],
    description: 'Works across both frontend and backend of web applications.',
  },
  {
    id: 'mobile-app-developer',
    title: 'Mobile App Developer',
    track: 'engineering',
    required_skills: ['Mobile Development', 'Object-Oriented Programming', 'REST APIs', 'Git', 'UI Design', 'State Management'],
    description: 'Develops native or cross-platform applications for iOS and Android.',
  },
  {
    id: 'qa-automation-engineer',
    title: 'QA / Automation Engineer',
    track: 'engineering',
    required_skills: ['Testing', 'Debugging', 'Python', 'Git', 'CI/CD', 'Software Development Lifecycle'],
    description: 'Designs automated test suites and validates software quality before release.',
  },
  {
    id: 'devops-engineer',
    title: 'Junior DevOps Engineer',
    track: 'engineering',
    required_skills: ['Linux', 'Docker', 'CI/CD', 'Cloud Computing', 'Networking', 'Scripting', 'Git'],
    description: 'Automates build, deployment and infrastructure operations.',
  },
  {
    id: 'cloud-engineer',
    title: 'Cloud Engineer',
    track: 'engineering',
    required_skills: ['Cloud Computing', 'Networking', 'Linux', 'Security', 'Databases', 'Infrastructure as Code'],
    description: 'Designs and maintains cloud infrastructure on AWS, Azure or GCP.',
  },
  {
    id: 'security-analyst',
    title: 'Information Security Analyst',
    track: 'engineering',
    required_skills: ['Security', 'Networking', 'Cryptography', 'Operating Systems', 'Risk Assessment', 'Linux'],
    description: 'Monitors systems for threats and hardens infrastructure against attacks.',
  },
  {
    id: 'embedded-systems-engineer',
    title: 'Embedded Systems Engineer',
    track: 'engineering',
    required_skills: ['C Programming', 'Operating Systems', 'Computer Architecture', 'Debugging', 'Microcontrollers'],
    description: 'Programs low-level software that runs directly on hardware devices.',
  },
  {
    id: 'systems-engineer',
    title: 'Systems Engineer',
    track: 'engineering',
    required_skills: ['Operating Systems', 'Computer Networks', 'Linux', 'Scripting', 'Computer Architecture', 'Debugging'],
    description: 'Maintains and optimises server and operating-system level infrastructure.',
  },
  {
    id: 'data-analyst',
    title: 'Data Analyst',
    track: 'data',
    required_skills: ['SQL', 'Statistics', 'Data Visualization', 'Excel', 'Python', 'Critical Thinking'],
    description: 'Turns raw datasets into dashboards and insight for business decisions.',
  },
  {
    id: 'junior-data-scientist',
    title: 'Junior Data Scientist',
    track: 'data',
    required_skills: ['Python', 'Statistics', 'Machine Learning', 'Linear Algebra', 'Data Visualization', 'SQL', 'Probability'],
    description: 'Builds predictive models and runs experiments on large datasets.',
  },
  {
    id: 'machine-learning-engineer',
    title: 'Machine Learning Engineer',
    track: 'data',
    required_skills: ['Machine Learning', 'Python', 'Linear Algebra', 'Calculus', 'Deep Learning', 'Data Structures', 'Cloud Computing'],
    description: 'Trains and deploys machine learning models into production systems.',
  },
  {
    id: 'data-engineer',
    title: 'Data Engineer',
    track: 'data',
    required_skills: ['SQL', 'Python', 'Databases', 'Data Modeling', 'ETL', 'Cloud Computing', 'Distributed Systems'],
    description: 'Builds the pipelines that move and reshape data across an organisation.',
  },
  {
    id: 'bi-analyst',
    title: 'Business Intelligence Analyst',
    track: 'data',
    required_skills: ['SQL', 'Data Visualization', 'Statistics', 'Business Analysis', 'Excel', 'Communication'],
    description: 'Reports on business performance using warehouse data and BI tooling.',
  },
  {
    id: 'ai-research-assistant',
    title: 'AI Research Assistant',
    track: 'data',
    required_skills: ['Machine Learning', 'Linear Algebra', 'Probability', 'Python', 'Research Methods', 'Deep Learning', 'Technical Writing'],
    description: 'Supports academic or industrial research on machine learning methods.',
  },
  {
    id: 'product-manager-intern',
    title: 'Associate Product Manager',
    track: 'product',
    required_skills: ['Product Strategy', 'User Research', 'Communication', 'Data Analysis', 'Agile', 'Roadmapping'],
    description: 'Defines what to build and why, coordinating design and engineering.',
  },
  {
    id: 'business-analyst',
    title: 'Business Analyst',
    track: 'business',
    required_skills: ['Business Analysis', 'Requirements Gathering', 'SQL', 'Process Modeling', 'Communication', 'Excel'],
    description: 'Translates business problems into documented system requirements.',
  },
  {
    id: 'technical-program-manager',
    title: 'Technical Program Manager',
    track: 'product',
    required_skills: ['Project Management', 'Agile', 'Communication', 'Risk Assessment', 'Software Development Lifecycle', 'Stakeholder Management'],
    description: 'Drives cross-team technical programs from planning to delivery.',
  },
  {
    id: 'management-consultant',
    title: 'Junior Management Consultant',
    track: 'business',
    required_skills: ['Problem Solving', 'Financial Analysis', 'Communication', 'Presentation Skills', 'Market Research', 'Excel'],
    description: 'Advises client organisations on strategy and operational improvement.',
  },
  {
    id: 'financial-analyst',
    title: 'Financial Analyst',
    track: 'business',
    required_skills: ['Financial Analysis', 'Accounting', 'Excel', 'Statistics', 'Valuation', 'Economics'],
    description: 'Models company financials and supports investment decisions.',
  },
  {
    id: 'marketing-analyst',
    title: 'Marketing Analyst',
    track: 'business',
    required_skills: ['Market Research', 'Data Analysis', 'Statistics', 'Communication', 'Consumer Behavior', 'Excel'],
    description: 'Measures campaign performance and identifies growth opportunities.',
  },
  {
    id: 'operations-analyst',
    title: 'Operations Analyst',
    track: 'business',
    required_skills: ['Process Modeling', 'Data Analysis', 'Supply Chain', 'Excel', 'Statistics', 'Problem Solving'],
    description: 'Optimises internal operations and supply-chain efficiency.',
  },
  {
    id: 'ux-designer',
    title: 'Junior UX Designer',
    track: 'design',
    required_skills: ['User Research', 'Wireframing', 'Prototyping', 'UI Design', 'Usability Testing', 'Visual Design'],
    description: 'Researches user needs and designs the flows that meet them.',
  },
  {
    id: 'ui-engineer',
    title: 'UI Engineer',
    track: 'design',
    required_skills: ['HTML', 'CSS', 'JavaScript', 'UI Design', 'Accessibility', 'Responsive Design', 'Design Systems'],
    description: 'Implements polished, accessible interface components in code.',
  },
  {
    id: 'technical-writer',
    title: 'Technical Writer',
    track: 'product',
    required_skills: ['Technical Writing', 'Communication', 'Research Methods', 'Git', 'Information Architecture'],
    description: 'Documents software products for developer and end-user audiences.',
  },
];

export function getJobRoleById(id: string): JobRole | undefined {
  return JOB_ROLES.find((role) => role.id === id);
}
