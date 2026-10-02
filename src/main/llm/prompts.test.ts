import { describe, expect, it } from 'vitest';
import {
  clauseExtractInput,
  criticInput,
  DOC_TEXT,
  docProfileInput,
  GRADING_RULES,
  judgeInput,
  specSummaryInput,
} from './__fixtures__/samples';
import {
  clauseExtractV1,
  criticV1,
  CURRENT_PROMPTS,
  docProfileV1,
  judgeV1,
  PROMPT_VERSIONS,
  reportFindingTool,
  severityFromTool,
  specSummaryV1,
} from './prompts';
import { buildRequest, cacheKeyForRequest } from './request';

describe('реєстр промптів', () => {
  it('версія кожного промпта — рядок виду "<stage>.v<N>" і збігається з етапом', () => {
    for (const [stage, prompt] of Object.entries(CURRENT_PROMPTS)) {
      expect(prompt.stage).toBe(stage);
      expect(prompt.version).toMatch(/^[a-z_]+\.v\d+$/);
      expect(prompt.version.startsWith(`${stage}.`)).toBe(true);
      expect(PROMPT_VERSIONS[prompt.stage]).toBe(prompt.version);
    }
  });

  it('промпти англійською — у system немає кирилиці', () => {
    for (const prompt of Object.values(CURRENT_PROMPTS)) {
      expect(prompt.system).not.toMatch(/[Ѐ-ӿ]/);
    }
  });

  it('у промптах немає таймстемпів — інакше кеш ніколи не влучає', () => {
    for (const prompt of Object.values(CURRENT_PROMPTS)) {
      expect(prompt.system).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    }
  });
});

describe('judge.v1', () => {
  const req = buildRequest(judgeV1, judgeInput);

  it('версія — judge.v1', () => {
    expect(judgeV1.version).toBe('judge.v1');
    expect(req.promptVersion).toBe('judge.v1');
  });

  it('текст документа і grading rules — у кешованому системному префіксі', () => {
    expect(req.cachedPrefix).toBeDefined();
    expect(req.cachedPrefix).toContain(DOC_TEXT);
    expect(req.cachedPrefix).toContain(GRADING_RULES);
    expect(req.cachedPrefix).toContain('<document name="Pest Management" version="002">');
  });

  it('батч вимог секції — у user-повідомленні, а не в system', () => {
    const user = req.messages[0]?.content ?? '';
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0]?.role).toBe('user');
    expect(user).toContain('<clauses count="2">');
    expect(user).toContain('<clause no="10.3"');
    expect(user).toContain('<clause no="10.4"');
    expect(user).toContain('site map showing the location of all monitoring devices');
    expect(user).toContain('For each clause call `report_finding` exactly once.');
    // Документ у messages не дублюється — інакше кеш не має сенсу.
    expect(user).not.toContain(DOC_TEXT);
    expect(judgeV1.system).not.toContain(DOC_TEXT);
  });

  it('використовує strict tool use — інакше citations не поєднати зі схемою', () => {
    expect(req.tool).toBe(reportFindingTool);
    expect(reportFindingTool.name).toBe('report_finding');
    expect(reportFindingTool.multiCall).toBe(true);
    expect(reportFindingTool.inputSchema.additionalProperties).toBe(false);
    expect(reportFindingTool.inputSchema.required).toEqual([
      'clause_no',
      'verdict',
      'rationale',
      'evidence',
      'confidence',
    ]);
  });

  it('стрімінг увімкнеться: max_tokens вище порогу', () => {
    expect(req.maxOutputTokens).toBeGreaterThan(8_000);
    expect(req.effort).toBe('high');
  });

  it('snapshot system + user', () => {
    expect({ system: judgeV1.system, user: req.messages[0]?.content }).toMatchSnapshot();
  });
});

describe('critic.v1', () => {
  const req = buildRequest(criticV1, criticInput);

  it('отримує вимогу і цитати, а не весь документ', () => {
    const user = req.messages[0]?.content ?? '';
    expect(user).toContain('<clause no="10.3">');
    expect(user).toContain('<claimed_evidence count="2">');
    expect(user).toContain('Monitoring devices are numbered and shown on a site map.');
    expect(user).not.toContain(DOC_TEXT);
    expect(req.cachedPrefix).toBeUndefined();
    expect(req.documents).toBeUndefined();
  });

  it('перевіряє тільки compliant', () => {
    expect(criticV1.system).toContain('The finding claims COMPLIANT');
  });

  it('snapshot', () => {
    expect({ system: criticV1.system, user: req.messages[0]?.content }).toMatchSnapshot();
  });
});

describe('clause_extract.v1', () => {
  const req = buildRequest(clauseExtractV1, clauseExtractInput);

  it('сторінка з сусіднім контекстом — у user', () => {
    const user = req.messages[0]?.content ?? '';
    expect(user).toContain('<page no="34">');
    expect(user).toContain('<previous_page_tail>');
    expect(user).toContain('<next_page_head>');
    expect(user).toContain('P R  10.3  Pest management programme specification');
  });

  it('structured output — інструмента немає', () => {
    expect(req.tool).toBeUndefined();
  });

  it('snapshot', () => {
    expect({ system: clauseExtractV1.system, user: req.messages[0]?.content }).toMatchSnapshot();
  });
});

describe('spec_summary.v1', () => {
  const req = buildRequest(specSummaryV1, specSummaryInput);

  it('текст спеки — у кешованому префіксі, перелік секцій — у user', () => {
    expect(req.cachedPrefix).toContain('Auditing of Standard');
    expect(req.messages[0]?.content).toContain('<section no="10">Pest management</section>');
  });

  it('snapshot', () => {
    expect({ system: specSummaryV1.system, user: req.messages[0]?.content }).toMatchSnapshot();
  });
});

describe('doc_profile.v1', () => {
  const req = buildRequest(docProfileV1, docProfileInput);

  it('документ — у префіксі, скорочений реєстр вимог — у user', () => {
    expect(req.cachedPrefix).toContain(DOC_TEXT);
    const user = req.messages[0]?.content ?? '';
    expect(user).toContain('<clause_index count="3">');
    expect(user).toContain('<clause no="10.3">Pest management programme specification</clause>');
    expect(user).not.toContain('The site must have a documented pest management programme');
  });

  it('snapshot', () => {
    expect({ system: docProfileV1.system, user: req.messages[0]?.content }).toMatchSnapshot();
  });
});

// ─── Мова результатів ────────────────────────────────────────────────────────

describe('мова результатів у промптах', () => {
  const MODEL = 'claude-opus-5';
  const userOf = (req: { messages: Array<{ content: string }> }): string => req.messages[0]?.content ?? '';

  /** Промпти, де модель пише текст для людини, і як їх зібрати з мовою. */
  const withLanguage = {
    judge: (language: '' | 'en' | 'nl' | 'uk') => buildRequest(judgeV1, { ...judgeInput, language }),
    critic: (language: '' | 'en' | 'nl' | 'uk') => buildRequest(criticV1, { ...criticInput, language }),
    spec_summary: (language: '' | 'en' | 'nl' | 'uk') =>
      buildRequest(specSummaryV1, { ...specSummaryInput, language }),
  };
  const withoutLanguage = {
    judge: () => buildRequest(judgeV1, judgeInput),
    critic: () => buildRequest(criticV1, criticInput),
    spec_summary: () => buildRequest(specSummaryV1, specSummaryInput),
  };
  const stages = ['judge', 'critic', 'spec_summary'] as const;

  it.each(stages)('%s: мовою стандарту промпт і ключ кешу байт-у-байт ті самі', (stage) => {
    // На цьому тримаються знімки промптів і вже накопичений кеш.
    const plain = withoutLanguage[stage]();
    const empty = withLanguage[stage]('');
    expect(userOf(empty)).toBe(userOf(plain));
    expect(empty.cacheInput).toEqual(plain.cacheInput);
    expect(cacheKeyForRequest(empty, MODEL)).toBe(cacheKeyForRequest(plain, MODEL));
  });

  it.each(stages)('%s: інша мова — інший ключ кешу', (stage) => {
    // Інакше висновок, закешований українською, віддавався б і на запит нідерландською.
    const keys = (['', 'en', 'nl', 'uk'] as const).map((language) =>
      cacheKeyForRequest(withLanguage[stage](language), MODEL),
    );
    expect(new Set(keys).size).toBe(4);
  });

  it.each(stages)('%s: інструкція є лише з мовою і завжди забороняє перекладати цитати', (stage) => {
    expect(userOf(withLanguage[stage](''))).not.toContain('never translate');

    const dutch = userOf(withLanguage[stage]('nl'));
    expect(dutch).toContain('in Dutch');
    expect(dutch).toContain('Keep every `quote` EXACTLY as it appears in the source document');
    expect(dutch).toContain('never translate');
  });

  it('judge: перекладає висновки, але не вердикти й severity', () => {
    const user = userOf(withLanguage.judge('uk'));
    expect(user).toContain('Write `rationale`, `gap` and `recommendation` in Ukrainian.');
    expect(user).toContain('Keep clause numbers, verdict and severity values unchanged');
  });

  it('critic: пояснення критика — мовою результатів, вердикт — кодом схеми', () => {
    // `reason` дописується в rationale finding'а — користувач читає його поруч із висновком.
    const user = userOf(withLanguage.critic('uk'));
    expect(user).toContain('Write `reason` and `missingElements` in Ukrainian.');
    expect(user).toContain('`suggestedVerdict` value unchanged');
  });

  it('spec_summary: самарі мовою результатів, правила градації — дослівно', () => {
    const user = userOf(withLanguage.spec_summary('nl'));
    expect(user).toContain('Write `summary`, `scope` and `sectionSummaries[].summary` in Dutch.');
    expect(user).toContain('Never translate `gradingRules`');
    expect(user).toContain('original language of the standard');
  });

  it('clause_extract і doc_profile мови не мають: реєстр дослівний, профіль — службовий', () => {
    expect(userOf(buildRequest(clauseExtractV1, clauseExtractInput))).not.toContain('never translate');
    expect(userOf(buildRequest(docProfileV1, docProfileInput))).not.toContain('never translate');
  });
});

describe('severityFromTool', () => {
  it('"none" і undefined перетворюються на null', () => {
    expect(severityFromTool('none')).toBeNull();
    expect(severityFromTool(undefined)).toBeNull();
    expect(severityFromTool('major')).toBe('major');
  });
});
