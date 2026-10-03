import { describe, expect, it } from 'vitest';
import {
  clauseExtractInput,
  clauseExtractProseInput,
  criticInput,
  criticV2Input,
  criticV2PlainInput,
  DOC_TEXT,
  docProfileInput,
  GRADING_RULES,
  judgeInput,
  judgeV2Input,
  judgeV2PlainInput,
  markerLegendInput,
  specSummaryInput,
  TESCO_LEGEND,
} from './__fixtures__/samples';
import {
  clauseExtractV1,
  clauseExtractV2,
  clauseExtractV2Schema,
  criticSchema,
  criticV1,
  criticV2,
  CURRENT_PROMPTS,
  docProfileV1,
  judgeV1,
  judgeV2,
  judgeV2Schema,
  markerLegendSchema,
  markerLegendV1,
  PROMPT_VERSIONS,
  reportFindingTool,
  reportFindingToolV2,
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

describe('judge.v2 — позначки стандарту', () => {
  const req = buildRequest(judgeV2, judgeV2Input);
  const plain = buildRequest(judgeV2, judgeV2PlainInput);
  const MODEL = 'claude-opus-5';
  const userOf = (r: { messages: Array<{ content: string }> }): string => r.messages[0]?.content ?? '';
  /** Префікс без тексту документа — для знімків і перевірок порядку. */
  const prefixHead = (r: { cachedPrefix?: string }): string => (r.cachedPrefix ?? '').split('<document')[0] ?? '';

  it('поточна версія судження — v2; v1 лишився лише для історії', () => {
    expect(judgeV2.version).toBe('judge.v2');
    expect(req.promptVersion).toBe('judge.v2');
    expect(CURRENT_PROMPTS.judge).toBe(judgeV2);
    expect(PROMPT_VERSIONS.judge).toBe('judge.v2');
    expect(cacheKeyForRequest(req, MODEL)).not.toBe(cacheKeyForRequest(buildRequest(judgeV1, judgeInput), MODEL));
  });

  it('легенда — у кешованому префіксі між grading rules і документом, словами стандарту', () => {
    const prefix = req.cachedPrefix ?? '';
    const rules = prefix.indexOf('<grading_rules>');
    const legend = prefix.indexOf('<marker_legend count="3">');
    const document = prefix.indexOf('<document name="Pest Management" version="002">');
    expect(rules).toBeGreaterThanOrEqual(0);
    expect(legend).toBeGreaterThan(rules);
    expect(document).toBeGreaterThan(legend);
    expect(prefix).toContain(
      '<marker code="R" label="Records">\nThe site must have comprehensive accurately completed records to demonstrate compliance\n</marker>',
    );
    // Легенда в префіксі, а не в кожному батчі.
    expect(userOf(req)).not.toContain('<marker_legend');
  });

  it('кожна вимога несе свої позначки атрибутом markers', () => {
    const user = userOf(req);
    expect(user).toContain(
      '<clause no="10.3" topic="Pest management programme specification" obligation="must" markers="P, R">',
    );
    expect(user).toContain('<clause no="10.4" topic="Pest management contractor" obligation="must" markers="P, R, O">');
  });

  it('стандарт без позначок: ні легенди, ні атрибутів markers — і той самий текст, що в v1', () => {
    expect(plain.cachedPrefix).not.toContain('marker_legend');
    expect(userOf(plain)).not.toContain('markers=');
    // Різниця з v1 лише в system (загальний розділ про позначки) і схемі інструмента.
    const v1 = buildRequest(judgeV1, judgeInput);
    expect(userOf(plain)).toBe(userOf(v1));
    expect(plain.cachedPrefix).toBe(v1.cachedPrefix);
  });

  it('позначки є, легенди немає — атрибути лишаються, блоку легенди немає', () => {
    const noLegend = buildRequest(judgeV2, { ...judgeV2Input, markerLegend: null });
    expect(noLegend.cachedPrefix).not.toContain('marker_legend');
    expect(userOf(noLegend)).toContain('markers="P, R"');
  });

  it('легенда екранується; назва-дубль коду і відсутнє пояснення — явно', () => {
    const odd = buildRequest(judgeV2, {
      ...judgeV2PlainInput,
      markerLegend: [
        { code: 'A&B "x"', label: '<Major>', meaning: 'Shown by records & logs' },
        { code: 'Major Must', label: 'Major Must', meaning: null },
      ],
    });
    const head = prefixHead(odd);
    expect(head).toContain('<marker code="A&amp;B &quot;x&quot;" label="&lt;Major&gt;">');
    expect(head).toContain('<marker code="Major Must">\n(The standard does not explain this marker.)\n</marker>');
  });

  it('system: загальний розділ про позначки без назв стандартів і зашитих кодів, правила v1 на місці', () => {
    const system = judgeV2.system;
    expect(system).toContain('You are assessing a DOCUMENT.');
    expect(system).toContain('do NOT mark the clause `partial` or `non_compliant` merely because the document is');
    expect(system).toContain('describe in `outside_evidence` what the auditor must verify outside the');
    expect(system).toContain('that IS a gap');
    expect(system).toContain('never infer a requirement from a bare code');
    expect(system).not.toMatch(/Tesco|GlobalG|BRCGS|\bP\b|\bR\b|\bO\b|Major Must/);
    // Правила v1.
    expect(system).toContain('Check EVERY bullet');
    expect(system).toContain('this is NOT the same as\n`non_compliant`');
    expect(system).toContain('"must" is mandatory, "should" is a recommendation');
    expect(system).toContain('Quotes must be copied character for character');
  });

  it('інструмент: той самий report_finding плюс необовʼязкове outside_evidence', () => {
    expect(req.tool).toBe(reportFindingToolV2);
    expect(reportFindingToolV2.name).toBe('report_finding');
    expect(reportFindingToolV2.multiCall).toBe(true);
    expect(reportFindingToolV2.inputSchema.required).toEqual(reportFindingTool.inputSchema.required);
    expect(reportFindingToolV2.inputSchema.properties.outside_evidence).toEqual({
      type: 'string',
      description:
        'What must be verified outside this document — records, on-site observation — according to the clause markers and legend. Omit when nothing.',
    });
    // Обмеження, які Anthropic відхиляє в схемі інструмента, сюди не потрапили.
    expect(JSON.stringify(reportFindingToolV2.inputSchema)).not.toMatch(/minimum|maximum|minLength/);
    // v1 не змінився.
    expect(reportFindingTool.inputSchema.properties).not.toHaveProperty('outside_evidence');
  });

  it('схема відповіді приймає finding і з outside_evidence, і без нього', () => {
    const base = {
      clause_no: '10.3',
      verdict: 'compliant',
      confidence: 0.9,
      rationale: 'Procedure covers every bullet.',
      evidence: [{ quote: 'Monitoring devices are numbered and shown on a site map.' }],
    };
    const parsed = judgeV2Schema.parse([base, { ...base, clause_no: '10.4', outside_evidence: 'Check the visit reports.' }]);
    expect(parsed[0]?.outside_evidence).toBeUndefined();
    expect(parsed[1]?.outside_evidence).toBe('Check the visit reports.');
  });

  it('ключ кешу чутливий до позначок і легенди', () => {
    const key = (input: typeof judgeV2Input) => cacheKeyForRequest(buildRequest(judgeV2, input), MODEL);
    const base = key(judgeV2Input);
    expect(key({ ...judgeV2Input })).toBe(base);

    const fewerMarkers = {
      ...judgeV2Input,
      clauses: [{ ...judgeV2Input.clauses[0]!, markers: ['P'] }, judgeV2Input.clauses[1]!],
    };
    const otherMeaning = {
      ...judgeV2Input,
      markerLegend: TESCO_LEGEND.map((item) => (item.code === 'R' ? { ...item, meaning: 'Records are optional.' } : item)),
    };
    const noLegend = { ...judgeV2Input, markerLegend: null };
    const keys = [base, key(fewerMarkers), key(otherMeaning), key(noLegend), key(judgeV2PlainInput)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('snapshot з позначками і легендою', () => {
    expect({ system: judgeV2.system, prefix: prefixHead(req), user: userOf(req) }).toMatchSnapshot();
  });

  it('snapshot стандарту без позначок', () => {
    expect({ prefix: prefixHead(plain), user: userOf(plain) }).toMatchSnapshot();
  });
});

describe('critic.v2 — позначки стандарту', () => {
  const req = buildRequest(criticV2, criticV2Input);
  const plain = buildRequest(criticV2, criticV2PlainInput);
  const MODEL = 'claude-opus-5';
  const userOf = (r: { messages: Array<{ content: string }> }): string => r.messages[0]?.content ?? '';

  it('поточна версія критика — v2 зі схемою v1', () => {
    expect(criticV2.version).toBe('critic.v2');
    expect(CURRENT_PROMPTS.critic).toBe(criticV2);
    expect(PROMPT_VERSIONS.critic).toBe('critic.v2');
    expect(criticV2.schema).toBe(criticSchema);
    expect(req.cachedPrefix).toBeUndefined();
  });

  it('бачить позначки вимоги, лише її пункти легенди і висновок «поза документом»', () => {
    const user = userOf(req);
    expect(user).toContain('<clause no="10.3" markers="P, R">');
    expect(user).toContain('<marker_legend count="2">');
    expect(user).toContain('<marker code="P" label="Policy / procedure">');
    expect(user).toContain('<marker code="R" label="Records">');
    expect(user).not.toContain('label="Observation"');
    expect(user).toContain(
      '<claimed_outside_evidence>\nInspect the contractor visit reports and the trend analysis for the last 12 months.\n</claimed_outside_evidence>',
    );
    expect(user).not.toContain(DOC_TEXT);
  });

  it('без позначок — той самий user, що в v1: ні легенди, ні markers, ні «поза документом»', () => {
    const user = userOf(plain);
    expect(user).not.toContain('marker_legend');
    expect(user).not.toContain('markers=');
    expect(user).not.toContain('claimed_outside_evidence');
    expect(user).toBe(userOf(buildRequest(criticV1, criticInput)));
  });

  it('перевірка №2: загальний виняток для записів/огляду, без назв стандартів і кодів', () => {
    const system = criticV2.system;
    // Текст v1 лишається — без позначок перевірка та сама.
    expect(system).toContain(
      'Does the evidence describe an intention/policy where the clause requires a documented\n   procedure, a record, or evidence of execution?',
    );
    expect(system).toContain('the document is only\n   expected to provide the documented part');
    expect(system).toContain('are then NOT a\n   reason to disagree');
    expect(system).toContain('never infer a requirement from a bare code');
    expect(system).not.toMatch(/Tesco|GlobalG|BRCGS|\bP\b|\bR\b|\bO\b|Major Must/);
    expect(system).toContain('Return `agree` only if you can defend COMPLIANT against all three.');
  });

  it('ключ кешу чутливий до позначок, легенди і висновку «поза документом»', () => {
    const key = (input: typeof criticV2Input) => cacheKeyForRequest(buildRequest(criticV2, input), MODEL);
    const keys = [
      key(criticV2Input),
      key({ ...criticV2Input, clause: { ...criticV2Input.clause, markers: ['P'] } }),
      key({ ...criticV2Input, markerLegend: TESCO_LEGEND.slice(0, 1) }),
      key({ ...criticV2Input, claimedOutsideEvidence: 'Observe the bait stations.' }),
      key(criticV2PlainInput),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(key({ ...criticV2Input })).toBe(keys[0]);
  });

  it('snapshot з позначками', () => {
    expect({ system: criticV2.system, user: userOf(req) }).toMatchSnapshot();
  });

  it('snapshot без позначок', () => {
    expect({ user: userOf(plain) }).toMatchSnapshot();
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

describe('clause_extract.v2', () => {
  const req = buildRequest(clauseExtractV2, clauseExtractInput);

  it('поточна версія етапу — v2; v1 лишився лише для історії', () => {
    expect(CURRENT_PROMPTS.clause_extract).toBe(clauseExtractV2);
    expect(PROMPT_VERSIONS.clause_extract).toBe('clause_extract.v2');
    expect(req.promptVersion).toBe('clause_extract.v2');
  });

  it('інша версія — інший ключ кешу на тій самій сторінці', () => {
    const v1 = buildRequest(clauseExtractV1, clauseExtractInput);
    expect(cacheKeyForRequest(req, 'claude-sonnet-5')).not.toBe(cacheKeyForRequest(v1, 'claude-sonnet-5'));
  });

  it('формат стандарту не зашитий: таблиця або проза, номери з літерами', () => {
    expect(clauseExtractV2.system).toContain('numbered paragraphs of prose');
    expect(clauseExtractV2.system).toContain('"A.5.1", "AF 1.2.3"');
    expect(clauseExtractV2.system).not.toContain('If the page contains no clause table');
    expect(clauseExtractV2.system).not.toContain('modules');
  });

  it('позначки — дослівно, без вигадування й перекладу', () => {
    expect(clauseExtractV2.system).toContain('`markers`');
    expect(clauseExtractV2.system).toContain('Never invent, expand, translate or normalise a marker');
    expect(clauseExtractV2.system).toContain('"P R  1.3 …" → ["P","R"]');
  });

  it('сторінка прози з додатком ISO — у user, контекст сусідньої сторінки теж', () => {
    const user = buildRequest(clauseExtractV2, clauseExtractProseInput).messages[0]?.content ?? '';
    expect(user).toContain('Standard: ISO/IEC 27001 v2022. Page 14.');
    expect(user).toContain('A.5.1 Policies for information security');
    expect(user).toContain('<next_page_head>\nA.5.3 Segregation of duties\n</next_page_head>');
  });

  it('схема: markers — довільні рядки, modules більше немає', () => {
    const parsed = clauseExtractV2Schema.parse({
      clauses: [
        {
          clauseNo: 'AF 1.1.1',
          sectionNo: 'AF 1',
          sectionTitle: 'Site history and site management',
          topic: null,
          requirementText: 'Is there a reference system for each field?',
          markers: ['Major Must'],
          obligation: null,
          truncated: false,
        },
      ],
    });
    expect(parsed.clauses[0]?.markers).toEqual(['Major Must']);
    expect('modules' in (parsed.clauses[0] ?? {})).toBe(false);
  });

  it('structured output — інструмента немає', () => {
    expect(req.tool).toBeUndefined();
  });

  it('snapshot', () => {
    expect({ system: clauseExtractV2.system, user: req.messages[0]?.content }).toMatchSnapshot();
  });
});

describe('marker_legend.v1', () => {
  const req = buildRequest(markerLegendV1, markerLegendInput);

  it('той самий етап, що й екстракція реєстру, — та сама модель і облік', () => {
    expect(markerLegendV1.stage).toBe('clause_extract');
    expect(req.promptVersion).toBe('marker_legend.v1');
    expect(markerLegendV1.version).toMatch(/^[a-z_]+\.v\d+$/);
    expect(req.tool).toBeUndefined();
  });

  it('коди і вступ стандарту — у user', () => {
    const user = req.messages[0]?.content ?? '';
    expect(user).toContain('<markers count="3">\n<marker>P</marker>\n<marker>R</marker>\n<marker>O</marker>\n</markers>');
    expect(user).toContain('<introduction pages="1-11">');
    expect(user).toContain('Clause Layout');
    expect(user).toContain('Return one item for each of the 3 markers.');
  });

  it('пояснення — лише зі стандарту: null замість здогадки', () => {
    expect(markerLegendV1.system).toContain('Never explain a marker from general knowledge');
    expect(markerLegendV1.system).toContain('Use null when the provided text does not explain');
    expect(markerLegendV1.system).not.toMatch(/[Ѐ-ӿ]/);
  });

  it('схема приймає meaning: null', () => {
    expect(
      markerLegendSchema.safeParse({ items: [{ code: 'O', label: 'O', meaning: null }] }).success,
    ).toBe(true);
  });

  it('snapshot', () => {
    expect({ system: markerLegendV1.system, user: req.messages[0]?.content }).toMatchSnapshot();
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
    judge_v2: (language: '' | 'en' | 'nl' | 'uk') => buildRequest(judgeV2, { ...judgeV2Input, language }),
    critic_v2: (language: '' | 'en' | 'nl' | 'uk') => buildRequest(criticV2, { ...criticV2Input, language }),
    spec_summary: (language: '' | 'en' | 'nl' | 'uk') =>
      buildRequest(specSummaryV1, { ...specSummaryInput, language }),
  };
  const withoutLanguage = {
    judge: () => buildRequest(judgeV1, judgeInput),
    critic: () => buildRequest(criticV1, criticInput),
    judge_v2: () => buildRequest(judgeV2, judgeV2Input),
    critic_v2: () => buildRequest(criticV2, criticV2Input),
    spec_summary: () => buildRequest(specSummaryV1, specSummaryInput),
  };
  const stages = ['judge', 'critic', 'judge_v2', 'critic_v2', 'spec_summary'] as const;

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

  it('judge.v2: outside_evidence — теж мовою результатів', () => {
    // Це вільний текст для аудитора, як gap і recommendation.
    const user = userOf(withLanguage.judge_v2('uk'));
    expect(user).toContain('Write `rationale`, `gap`, `recommendation` and `outside_evidence` in Ukrainian.');
    expect(user).toContain('Keep clause numbers, verdict and severity values unchanged');
  });

  it('critic.v2: мова та сама, що в v1', () => {
    expect(userOf(withLanguage.critic_v2('nl'))).toContain('Write `reason` and `missingElements` in Dutch.');
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
    expect(userOf(buildRequest(clauseExtractV2, clauseExtractInput))).not.toContain('never translate');
    expect(userOf(buildRequest(markerLegendV1, markerLegendInput))).not.toContain('never translate');
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
