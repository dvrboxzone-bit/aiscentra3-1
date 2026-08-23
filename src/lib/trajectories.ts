/**
 * AIscentra — Trajectories data (company paths)
 *
 * Extracted to a shared module (was previously inline in
 * src/app/page.tsx only) once the Trajectories section moved from a
 * homepage anchor to its own dedicated /trajectories page -- single
 * source of truth, no duplicated literal data between the old
 * location and the new one.
 *
 * `domain` is each company's own real, current official domain --
 * used to fetch a real, verified favicon/logo via the SAME honest
 * pattern already established and tested elsewhere in this project
 * (buildFaviconUrl in src/lib/utils/source-links.ts, already used for
 * real signal-source favicons) -- never a fabricated icon.
 */
export interface Trajectory {
  name: string
  domain: string
  year: string
  status: string
  description: string
}

export const TRAJECTORIES: readonly Trajectory[] = [
  {
    name: 'DeepMind',
    domain: 'https://deepmind.google',
    year: '2010',
    status: 'ACTIVE',
    description:
      'Founded as an independent AI research lab, acquired by Google in 2014 and now operating as Google DeepMind.',
  },
  {
    name: 'Cruise',
    domain: 'https://getcruise.com',
    year: '2013',
    status: 'WOUND DOWN',
    description:
      'GM ended Cruise robotaxi development in 2024 and shifted the unit toward driver-assistance work.',
  },
  {
    name: 'OpenAI',
    domain: 'https://openai.com',
    year: '2015',
    status: 'ACTIVE',
    description:
      'Founded as a nonprofit AI lab, later restructured to raise capital and develop the GPT and ChatGPT product families.',
  },
  {
    name: 'Stability AI',
    domain: 'https://stability.ai',
    year: '2019',
    status: 'RESTRUCTURED',
    description:
      'The company behind Stable Diffusion changed leadership and reorganized its business after a period of financial pressure.',
  },
  {
    name: 'Anthropic',
    domain: 'https://anthropic.com',
    year: '2021',
    status: 'ACTIVE',
    description:
      'Founded by former OpenAI researchers around AI safety and interpretability, and developer of the Claude model family.',
  },
  {
    name: 'Inflection AI',
    domain: 'https://inflection.ai',
    year: '2022',
    status: 'ACQUI-HIRED',
    description:
      'After building the Pi assistant, its founders and much of its team joined Microsoft in 2024 while the company continued independently.',
  },
] as const
