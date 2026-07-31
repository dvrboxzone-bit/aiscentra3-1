# AISCENTRA MASTER AUDIT & IMPLEMENTATION PLAN

**Статус документа: ВРЕМЕННЫЙ ИСТОРИЧЕСКИЙ MASTER-ПЛАН**

**Дата фиксации исходного документа: 29 июля 2026 года**

---

## Governance-примечание (добавлено при переносе в каноническое хранилище)

Этот файл — содержательно точная конвертация исходного документа
`AIscentra_Master_Audit_and_Implementation_Plan.docx` (SHA-256 указан
в Evidence Manifest соответствующего PR) в Markdown.

**Важно понимать при чтении этого документа:**

- Это **временный, исторический** план, зафиксированный 29 июля 2026
  года. Он не является текущим операционным roadmap.
- Оценки, приоритеты, реестр проблем и последовательность фаз ниже
  отражают состояние аудита **на дату фиксации** и **намеренно не
  обновлены** под фактическое состояние на 31 июля 2026 года или
  позднее.
- Часть проблем, зафиксированных в этом документе как открытые (P0
  `/api/agent`, P0 `/api/admin/simulate-engine-v2`, P0
  `ignoreBuildErrors: true`), **с тех пор были частично закрыты**
  отдельными задачами (Phase 1A, PR #3; TypeScript gate restoration,
  PR #2) — этот файл **не переписан** под тот факт, чтобы сохранить
  подлинность исторического среза аудита. Актуальное текущее состояние
  фиксируется отдельно в `docs/governance/AISCENTRA_REPAIR_ROADMAP.md`.
- Не считать утверждения этого документа машинно подтверждённым
  текущим состоянием репозитория, CI, production или Supabase.
  Источниками текущего состояния остаются GitHub, CI, Vercel и
  Supabase.
- Текущий операционный документ, отражающий фактически пройденные и
  предстоящие шаги, — отдельный файл:
  `docs/governance/AISCENTRA_REPAIR_ROADMAP.md`. Исторический документ
  и текущий Repair Roadmap намеренно остаются разными файлами.

## Формат конвертации DOCX → Markdown

- Инструмент: `pandoc` (`pandoc -t markdown --wrap=none`).
- Сохранены: весь текст, порядок всех 10 разделов, оба приложения (A,
  B), все таблицы (реестр проблем, оценка аудита, таблица фаз, release
  gates, карта затрагиваемых областей), сквозная нумерация пунктов
  задач Claude (21–102, как в исходном DOCX).
- Изменения, вызванные только форматом конвертации (не содержанием):
  типографские длинные тире (`—`) в исходном DOCX могут отображаться
  как последовательность `---` в результате pandoc-рендеринга таблиц;
  структура markdown-таблиц (`  ---...---`) заменяет исходное
  DOCX-форматирование таблиц Word, содержание ячеек не изменено.
- Что не проверялось автоматически: точное визуальное форматирование
  (шрифты, отступы, разрывы страниц) исходного DOCX — Markdown не
  сохраняет визуальное форматирование, только структуру и содержание.
  Наличие всех разделов, приложений, строк таблиц и нумерации пунктов
  подтверждено вручную построчным сопоставлением с оглавлением
  исходного документа перед коммитом.

---

**AIscentra.com**

MASTER AUDIT & IMPLEMENTATION PLAN

_Единый архитектурный документ по исправлению, доработке и доведению проекта до уровня инвестиционно привлекательной production-платформы_

---

**Проект** AIscentra.com

---

**Основа** Независимый аудит репозитория aiscentra3-1 / загруженного архива проекта

**Режим** Архитектурное планирование без внесения изменений в исходный код

**Цель** Безопасное, последовательное и проверяемое внедрение улучшений

**Дата фиксации** 29 июля 2026

---

Важно: документ не обещает математически невозможные «100% безошибочности». Он задаёт систему этапов, проверок, rollback и release-gates, которая максимально приближает результат к предсказуемому и профессиональному уровню.

# Содержание

1.  1\. Статус и назначение документа

2.  2\. Зафиксированный итог аудита

3.  3\. Полный реестр проблем и приоритетов

4.  4\. Целевая архитектурная модель

5.  5\. Правила изменений и защиты проекта

6.  6\. Порядок реализации и зависимости

7.  7\. Готовые задачи для Claude

8.  8\. Release gates и критерии выхода в production

9.  9\. Протокол совместной работы: владелец --- ChatGPT --- Claude

10. 10\. Итоговое управленческое решение

# 1. Статус и назначение документа

Этот документ является единым master-планом для AIscentra.com. Он объединяет результаты независимого аудита, целевую архитектуру, последовательность исправлений, правила изменения кода, меры защиты production, критерии готовности и самодостаточные задачи для Claude.

Документ должен использоваться как главный источник решений до завершения описанной программы работ. Отдельные задачи Claude не должны противоречить этому плану; любые изменения порядка допускаются только после повторной оценки зависимостей и рисков.

## 1.1. Что означает цель «проект на 1 000 000 долларов»

- Не внешний дизайн и не количество AI-функций, а управляемая надёжность, безопасность и воспроизводимое качество.

- Доказуемая ценность продукта: релевантные данные, проверяемые выводы, provenance и контролируемая стоимость AI-операций.

- Архитектура, которую можно масштабировать без постоянных аварийных переписываний.

- Инвесторская и коммерческая готовность: auth, quotas, observability, тесты, документация, rollout и rollback.

- Отсутствие заведомо ложных обещаний. Гарантируется процесс и критерии, а не невозможный абсолютный результат.

## 1.2. Принцип внедрения

Claude работает как технический исполнитель и обязан вносить изменения только по одной завершённой фазе за раз. ChatGPT выступает архитектором и проверяющим: определяет порядок, оценивает последствия и принимает решение о переходе к следующей фазе. Владелец проекта принимает только продуктовые решения и не должен разбираться в путях, типах или миграциях.

# 2. Зафиксированный итог аудита

AIscentra --- содержательный production-прототип intelligence-платформы. Проект уже имеет рабочий Signal Engine V2, доменную модель, Supabase-миграции, cron-конвейер, AI-клиент и отдельный Agent Runtime. Главная проблема --- несоответствие между заявленной зрелостью отдельных компонентов и их фактическими гарантиями.

---

**Область** **Оценка** **Статус** **Главный вывод**

---

Архитектурная идея 8/10 Сильная Хорошо разделённые домены и осмысленный продуктовый каркас

Signal Engine V2 7/10 Зрелый MVP Лучшая часть backend, но нет транзакционного финального commit

Agent Runtime 4--7/10 Структура сильнее реализации Retrieval почти не зависит от запроса; execution в основном номинальный

Knowledge Graph 3/10 Каркас Схема есть, полноценного графового intelligence layer пока нет

Strategic Memory 1/10 Не реализована Нет накопления проверенных выводов и baseline

API security 3/10 Критический риск Публичные дорогие endpoints и service-role операции

Production readiness 4/10 Недостаточно TypeScript build gate отключён, тесты и release gates неполные

---

## 2.1. Главный продуктовый диагноз

Agent Runtime сейчас получает преимущественно последние записи, а не лучшие доказательства для конкретного запроса. Пока retrieval не станет query-aware и evidence-driven, новые агенты, память и премиальный интерфейс будут усиливать видимость продукта, а не качество intelligence.

# 3. Полный реестр проблем и приоритетов

---

**Приоритет** **Проблема** **Последствие** **Решение**

---

P0 Публичный /api/agent Неограниченные Groq-вызовы, утечка внутреннего runtime response, DoS и расход бюджета Закрыть auth, rate limit, quotas, POST DTO

P0 Публичный /api/admin/simulate-engine-v2 Публичный service-role endpoint пишет в БД и вызывает AI Admin guard или production disable

P0 ignoreBuildErrors: true Production допускает TypeScript-ошибки Устранить причины и вернуть обязательный type gate

P0 Нерелевантный retrieval LLM анализирует recent global context вместо query evidence Query parser + hybrid retrieval + reranking

P1 Execution Plan номинален LOAD-шаги не выполняют загрузку и не изменяют state Перенести загрузку в tools или честно изменить архитектурный контракт

P1 Нет abort по required step Отчёт генерируется после критической ошибки reasoning Fail-fast semantics

P1 Timeouts не применяются Риск Vercel timeout и зависших provider calls AbortController, deadline budget

P1 Evidence IDs не проверяются Модель может ссылаться на отсутствующие источники Deterministic evidence validator

P1 FACT не проверяется Prompt-level гарантия недостаточна Claim verifier и downgrade policy

P1 Нет транзакции Signal finalization Частичные состояния observations/signals/logs/graph Supabase RPC/transaction

P1 Decision log best effort Нарушается обещание полной трассируемости Сделать частью commit или изменить контракт

P1 Database type = {} Схема не проверяется компилятором Generated Supabase types в CI

P2 Knowledge Graph не полноценен Нет entity resolution, edges, provenance, temporal validity Пошагово построить graph pipeline

P2 Strategic Memory отсутствует Нет накопления знаний, baseline и history Вводить только после evidence validation

P2 Monitoring --- разовый analysis Нет подписки, состояния, scheduler и notification Реализовать monitoring lifecycle

P2 Нет полного test suite Нет воспроизводимой защиты scoring, routes и prompts Unit/integration/security/golden tests

P2 Нет централизованного auth Риск пропустить защиту нового endpoint Единый server guard

P3 Документация расходится с кодом Версии Next/provider/cron описаны неточно Синхронизировать после стабилизации

---

# 4. Целевая архитектурная модель

## 4.1. Безопасный внешний контур

- Public API принимает только валидированный DTO и не возвращает внутренний execution context.

- Authenticated user session определяет workspace, quota и permissions.

- Rate limiter и budget guard выполняются до любого AI-вызова.

- Admin, cron и machine-to-machine контуры используют разные секреты и разные guards.

- Detailed health, simulation и internal diagnostics доступны только администратору.

## 4.2. Intelligence Runtime

- Query Parser извлекает сущности, период, категории, сравниваемые объекты и ограничения.

- Planner формирует параметризованный план, а не статический список названий шагов.

- Execution tools реально выполняют retrieval и изменяют рабочее состояние.

- Hybrid retrieval объединяет entity, full-text, vector и temporal relevance.

- Reranker ограничивает контекст лучшими и разнообразными доказательствами.

- Reasoning запускается только при достаточном evidence coverage.

- Claims проходят deterministic validation до выдачи пользователю.

- Reflection может инициировать controlled retry, но не бесконечный цикл.

## 4.3. Signal Engine

- Hard rejection и SIS остаются детерминированными.

- Final publication выполняется в одной транзакции.

- Decision log, signal, observation linkage и обязательные graph writes имеют единый commit contract.

- Каждая операция имеет idempotency key.

- Ошибки графа и telemetry не скрываются.

## 4.4. Knowledge Graph и Strategic Memory

- Graph хранит canonical entities, observations, signals и отношения с provenance.

- Каждое отношение имеет confidence, source, valid_from/valid_to и статус подтверждения.

- Memory хранит только evidence-linked выводы, версии и supersession.

- Новые выводы не перезаписывают старые молча: они подтверждают, опровергают или заменяют их.

- Monitoring строится на baseline из памяти и проверяемом condition state.

# 5. Правила изменений и защиты проекта

11. Никакой большой «переписки проекта целиком». Изменения выполняются малыми архитектурно завершёнными фазами.

12. Перед каждой фазой Claude создаёт ветку и фиксирует baseline: build, type-check, lint, миграции и smoke-тесты.

13. Claude не меняет схему Supabase без миграции, rollback-плана и проверки существующих данных.

14. Claude не удаляет старое поведение в том же релизе, в котором вводится новое, если feature flag или совместимость возможны.

15. Любой публичный endpoint рассматривается как враждебная граница.

16. Любой AI output рассматривается как недоверенный до schema и evidence validation.

17. Никакие ошибки audit/decision logging не должны бесшумно подавляться.

18. Production deployment выполняется только после прохождения release gates.

19. Каждая задача завершается отчётом: что изменено, какие файлы, тесты, миграции, риски, rollback.

20. После каждой задачи ChatGPT проверяет diff и результат до выдачи следующей задачи.

# 6. Порядок реализации и зависимости

---

**Фаза** **Название** **Результат**

---

Фаза 0 Freeze & Baseline Инвентаризация, ветка, backup, текущее состояние CI и production

Фаза 1 Production Hardening Auth, rate limit, quotas, закрытие admin endpoints, public DTO

Фаза 2 Type Safety & CI Generated database types, устранение any, обязательный build gate

Фаза 3 Runtime Retrieval Refactor Query parser, parameterized plan, real execution tools, hybrid retrieval

Фаза 4 Evidence Integrity Evidence ID validator, FACT verifier, prompt injection safeguards

Фаза 5 Signal Transaction Integrity Transactional finalization, idempotency, decision log guarantees

Фаза 6 Observability & Tests Structured logs, metrics, tracing, unit/integration/security/golden tests

Фаза 7 Knowledge Graph Entity resolution, edges, provenance, graph retrieval

Фаза 8 Strategic Memory & Monitoring Versioned memory, baselines, subscriptions, notifications

Фаза 9 Productization Workspaces, quotas, billing readiness, saved investigations, documentation

---

Запрещено начинать Knowledge Graph, Strategic Memory, Multi-Agent или billing до завершения Фаз 1--6. Иначе проект накопит сложность на небезопасном и непроверяемом основании.

# 7. Готовые задачи для Claude

Задачи ниже должны передаваться Claude строго по порядку. После каждой задачи Claude обязан вернуть diff-summary, результаты тестов и точный rollback. Следующая задача не выдаётся до проверки предыдущей.

## Задача 0. Зафиксировать baseline и обеспечить безопасную точку отката

**ЗАДАЧА ДЛЯ CLAUDE**

**Контекст:** Начинается программа архитектурной доработки AIscentra. Нельзя менять production без воспроизводимого исходного состояния.

**Текущее состояние:** Репозиторий содержит рабочий прототип, но build/type-check не подтверждены как обязательные gates; схема Supabase и production data требуют защиты.

**Что сделать:**

21. Создай отдельную feature-ветку для программы hardening. Не вноси функциональные изменения в этой задаче.

22. Зафиксируй версии Node, npm, Next.js, TypeScript, Supabase CLI и зависимости.

23. Выполни npm ci, lint, type-check и build; сохрани полный результат и список ошибок.

24. Сними перечень существующих Supabase migrations и проверь их порядок без применения новых изменений.

25. Сделай резервную копию production schema и критических таблиц либо документируй подтверждённый Supabase backup/restore процесс.

26. Зафиксируй текущие ответы /api/health, /api/agent и simulation endpoint в безопасной среде.

27. Создай docs/implementation-baseline.md с commit SHA, командами, результатами и ограничениями.

**Критерии готовности:**

- Есть отдельная ветка и commit baseline.

- Известны все текущие build/type/lint ошибки.

- Есть проверяемый rollback к исходному commit и backup plan для Supabase.

- Никакой production-код не изменён.

**Проверка перед деплоем:**

- Не запускать destructive migrations.

- Не выводить secrets в логи или документацию.

- Проверить, что baseline-файл не содержит токены, URL с ключами и service-role credentials.

**Риски:**

- Установка зависимостей может зависеть от registry; зафиксировать внешнюю ошибку отдельно от ошибки проекта.

- Backup может быть недоступен на текущем тарифе Supabase; в таком случае экспортировать schema и критические данные безопасным способом.

## Задача 1. Закрыть критические production endpoints и ввести единый access-control слой

**ЗАДАЧА ДЛЯ CLAUDE**

**Контекст:** Публичные AI и admin endpoints создают финансовый, security и data-integrity риск.

**Текущее состояние:** Маршруты /api/agent и /api/admin/simulate-engine-v2 не имеют достаточной защиты; service-role операции выполняются на сервере.

**Что сделать:**

28. Инвентаризируй все src/app/api/\*\* route handlers и классифицируй public, authenticated user, admin, cron и internal machine routes.

29. Создай единые server-only guards для каждой категории, без дублирования ручной проверки в routes.

30. Закрой /api/agent authenticated session или временно admin-only режимом до появления пользовательских квот.

31. Закрой /api/admin/simulate-engine-v2 административной авторизацией; запрети вызов в production без admin session.

32. Раздели cron secret, admin auth и internal machine auth. Не используй один секрет как универсальный.

33. Переведи агентский вызов на POST с Zod DTO; GET оставить временно только как 405/410 без AI-вызова.

34. Возвращай публичный response DTO без raw context, execution steps, internal IDs и provider errors.

35. Добавь rate limit, per-user/per-IP ограничения и server-side budget guard до вызова Groq.

36. Сократи public health до ok/degraded; detailed health перенеси под admin guard.

**Критерии готовности:**

- Неавторизованный вызов AI/admin routes не запускает Groq и не пишет в Supabase.

- Все чувствительные routes используют централизованный guard.

- Есть тесты 401/403/429 и проверки отсутствия side effects.

- Public response не раскрывает внутренний runtime.

**Проверка перед деплоем:**

- Проверить локально, preview и production-like environment.

- Проверить CORS, cookies/session и server-only imports.

- Проверить, что cron Vercel продолжает работать с новым отдельным секретом.

- Проверить budget limit при параллельных запросах.

**Риски:**

- Ошибка guard может заблокировать cron или admin. Сохрани feature flag/rollback к старой схеме только для preview.

- Rate limiting без общей distributed storage может быть обходным на serverless; используй устойчивое хранилище.

- Не включать raw error.message в ответы клиенту.

## Задача 2. Восстановить TypeScript как обязательный production gate

**ЗАДАЧА ДЛЯ CLAUDE**

**Контекст:** Отключённый type gate позволяет отправлять в production несовместимый код.

**Текущее состояние:** next.config.ts содержит ignoreBuildErrors: true; Supabase Database type является пустым placeholder; встречаются any casts.

**Что сделать:**

37. Удали ignoreBuildErrors только после устранения всех ошибок, а не до.

38. Сгенерируй актуальные Supabase Database types из схемы и помести их в единый canonical файл.

39. Раздели generated database types и domain types через явный mapping layer.

40. Исправь причины unused/optional/exactOptionalPropertyTypes ошибок без ослабления tsconfig.

41. Устрани опасные as any в API, providers и Supabase queries; допустимые boundary casts изолируй и объясни.

42. Добавь CI-команды npm run type-check, lint и build как обязательные checks.

43. Зафиксируй совместимые версии Next.js и eslint-config-next.

**Критерии готовности:**

- npm run type-check проходит без ошибок.

- npm run build проходит с ignoreBuildErrors отсутствующим.

- Generated Supabase types соответствуют текущей схеме.

- CI блокирует merge при type/build/lint failure.

**Проверка перед деплоем:**

- Сравнить generated types с миграциями.

- Проверить API routes, server components и Supabase inserts/updates.

- Проверить, что upgrade/downgrade версий зависимостей не меняет runtime поведение.

**Риски:**

- Исправление типов может выявить реальные schema mismatches; не маскировать их casting.

- Изменение Next major или lint config не совмещать с функциональным refactor без необходимости.

## Задача 3. Превратить Agent Runtime в query-aware investigation engine

**ЗАДАЧА ДЛЯ CLAUDE**

**Контекст:** Качество продукта определяется retrieval, а не красотой LLM-ответа.

**Текущее состояние:** Context Loader загружает recent global observations/signals; Planner не передаёт сущности, период и категории; LOAD tools лишь считают уже загруженные данные.

**Что сделать:**

44. Добавь детерминированный Query Parser с Zod-моделью: task intent, entities, categories, time range, comparison subjects, requested depth и filters.

45. Измени Planner: каждый ExecutionStep получает валидированные параметры, а не пустой object.

46. Определи единый контракт stateful execution context; LOAD tools должны реально вызывать providers и добавлять данные.

47. Убери двойную загрузку. Context Loader должен либо стать bootstrap-only, либо быть заменён execution-driven retrieval.

48. Реализуй query-aware provider methods для entity/category/time range и related graph data.

49. Добавь hybrid retrieval: exact entity, full-text, semantic/vector и recency; затем reranking и source diversity.

50. Введи context budget и deduplication, чтобы LLM не получала повторяющиеся или нерелевантные записи.

51. Если обязательное evidence coverage отсутствует, фиксируй GAP и не выдавай уверенный report.

52. Добавь fail-fast для failed required step и реальные per-step/global timeouts через AbortController.

**Критерии готовности:**

- Запросы COMPARE, ENTITY, TIMELINE, TREND и INVESTIGATION получают различающийся релевантный контекст.

- Execution steps реально выполняют действия и изменяют state.

- План останавливается после обязательной ошибки.

- Есть метрики retrieval precision на заранее подготовленном наборе запросов.

- Существующий public API контракт сохранён через adapter либо версионирован.

**Проверка перед деплоем:**

- Прогнать golden queries минимум по 20 сценариям.

- Сравнить старый и новый retrieval по relevance, latency и token cost.

- Проверить timeout, empty data, provider failure и partial result.

- Выкатывать за feature flag с возможностью вернуть старый runtime.

**Риски:**

- Vector search может потребовать pgvector migration и backfill; не блокировать базовый full-text/entity refactor.

- Одновременное изменение planner, retrieval и response усложняет диагностику; разбить commits по слоям.

- Не сохранять LLM-extracted query entities без deterministic validation.

## Задача 4. Ввести строгую целостность evidence и claims

**ЗАДАЧА ДЛЯ CLAUDE**

**Контекст:** Платформа intelligence не может доверять только инструкциям в prompt.

**Текущее состояние:** Evidence IDs и тип FACT валидируются только схемой формы ответа, но не против переданного контекста и исходного содержания.

**Что сделать:**

53. После LLM response построй allowed evidence set из фактически переданного контекста.

54. Удаляй неизвестные evidence IDs; claim без допустимых evidence не может иметь тип FACT.

55. Реализуй policy: invalid FACT downgrade в INFERENCE/GAP либо reject всего reasoning результата.

56. Проверяй минимальный confidence threshold программно.

57. Добавь source snippets/hash, чтобы claim можно было связать с конкретным доказательством.

58. Разметь observation content как untrusted data; используй строгие delimiters и system policy против indirect prompt injection.

59. Добавь adversarial tests: fake IDs, instruction injection, malformed JSON, contradictory sources, unsupported facts.

60. Public report должен показывать citations/provenance, но не внутренние служебные поля.

**Критерии готовности:**

- Ни один FACT не выходит без существующего evidence ID.

- Невалидный AI output не ломает endpoint и не превращается в уверенный ответ.

- Prompt injection fixtures не изменяют требуемую JSON-схему и policy.

- Есть тестовый отчёт с трассировкой claim → source.

**Проверка перед деплоем:**

- Проверить backward compatibility сохранённых reasoning objects.

- Проверить token size после добавления snippets.

- Проверить ложные downgrade на реальных данных.

**Риски:**

- Полная автоматическая проверка смысла FACT невозможна; использовать rule-based и secondary verification только для high-impact claims.

- Не создавать бесконечный self-verification loop и неконтролируемые расходы.

## Задача 5. Сделать Signal Engine транзакционным и идемпотентным

**ЗАДАЧА ДЛЯ CLAUDE**

**Контекст:** Signal Engine является ядром продукта; частичные записи разрушают доверие к данным.

**Текущее состояние:** Observation, graph node, signal linkage и decision log пишутся отдельными запросами; часть ошибок подавляется.

**Что сделать:**

61. Определи atomic finalization contract для reject, weak signal и publish outcomes.

62. Создай Supabase/PostgreSQL RPC или server-side transaction для обязательных записей одного outcome.

63. Включи decision log в транзакционный commit, если документация продолжает обещать полную трассируемость.

64. Добавь idempotency key на observation processing и unique constraints для защиты от повторной публикации.

65. Сделай graph write обязательным или явно best-effort с persisted failure queue; не скрывай catch.

66. Добавь retry policy по классам ошибок и dead-letter/reprocessing механизм.

67. Записывай engine version, thresholds snapshot, rule trace и source provenance неизменно.

68. Подготовь data repair script для уже возникших частичных состояний.

**Критерии готовности:**

- При искусственном сбое в любой точке отсутствуют полузаписанные обязательные сущности.

- Повторный запуск одного observation не создаёт дубликат signal.

- Каждый outcome имеет decision log.

- Есть безопасный repair report для исторических данных.

**Проверка перед деплоем:**

- Сделать backup затрагиваемых таблиц.

- Тестировать migration и RPC на копии production schema.

- Проверить lock contention и batch performance.

- Выкатывать migration отдельно от переключения application code.

**Риски:**

- Долгие транзакции могут блокировать таблицы; держать finalization коротким.

- Unique constraints могут не примениться из-за существующих дублей; сначала провести data audit.

## Задача 6. Построить observability и автоматизированную защиту качества

**ЗАДАЧА ДЛЯ CLAUDE**

**Контекст:** Без telemetry и тестов проект нельзя безопасно развивать и оценивать.

**Текущее состояние:** Есть console logs и документы acceptance, но нет полного воспроизводимого test/monitoring layer.

**Что сделать:**

69. Введи structured logging с request_id, run_id, observation_id и без secrets/PII.

70. Добавь метрики: route latency, AI calls, token/cost estimate, rate-limit events, retrieval counts, reasoning failures, signal outcomes, transaction failures.

71. Добавь persistent Agent Run telemetry без сохранения лишнего raw user content.

72. Создай unit tests для SIS, validation, planner, parser, evidence validator и auth guards.

73. Создай integration tests для Supabase providers, Signal finalization и API routes.

74. Создай security tests для unauthorized access, rate limit, filter injection и prompt injection.

75. Создай golden dataset для retrieval и report quality; version fixtures.

76. Добавь CI coverage gates и smoke test preview deployment.

77. Настрой alerts по error rate, budget, cron failure и queue backlog.

**Критерии готовности:**

- Каждый production incident можно связать с run/request ID.

- CI воспроизводимо проверяет основные инварианты.

- Есть dashboard или отчёт по ключевым метрикам.

- Alerts тестово срабатывают и не раскрывают secrets.

**Проверка перед деплоем:**

- Проверить logging volume и стоимость хранения.

- Проверить redaction user queries и provider payloads.

- Проверить flaky tests и стабильность golden fixtures.

**Риски:**

- Слишком строгие golden tests могут блокировать полезные изменения prompts; разделить структурные и качественные thresholds.

- Не сохранять полный контекст по умолчанию из-за privacy и стоимости.

## Задача 7. Реализовать Knowledge Graph как рабочий intelligence layer

**ЗАДАЧА ДЛЯ CLAUDE**

**Контекст:** Graph должен повышать качество retrieval и выявлять связи, а не быть только таблицей observation nodes.

**Текущее состояние:** Нет полноценного entity resolution, relation extraction, temporal edges, confidence и graph-derived retrieval.

**Что сделать:**

78. Определи canonical graph model: entity, observation, signal, event, report и relation types.

79. Добавь entity extraction с deterministic normalization и controlled LLM assistance.

80. Реализуй entity resolution по canonical name, aliases и external identifiers; ambiguous matches не объединять автоматически.

81. Добавь edges с relation_type, confidence, provenance, valid_from, valid_to и extraction_version.

82. Добавь deduplication и supersession отношений.

83. Реализуй graph traversal provider с ограничением depth, node count и cycle protection.

84. Используй graph evidence в Agent Runtime только после provenance filtering.

85. Добавь backfill job, checkpointing и возможность повторного запуска.

86. Не смешивай сырые observations и validated signals без статуса качества.

**Критерии готовности:**

- Для тестовых сущностей граф воспроизводимо показывает подтверждённые связи и источники.

- Traversal не возвращает бесконечные циклы и не превышает context budget.

- Entity merge имеет audit trail и rollback.

- Graph retrieval измеримо улучшает часть golden queries.

**Проверка перед деплоем:**

- Выполнить schema migration и backfill на staging.

- Проверить false merges и graph explosion.

- Включать graph retrieval feature flag.

**Риски:**

- Ошибочное entity merge повреждает большое число связей; автоматическое объединение только при высоком confidence.

- Backfill может быть дорогим; применять batches и budget limits.

## Задача 8. Реализовать Strategic Memory и настоящий Monitoring

**ЗАДАЧА ДЛЯ CLAUDE**

**Контекст:** Memory должна накапливать только проверенные знания и обеспечивать temporal intelligence.

**Текущее состояние:** Memory provider фактически пуст; Monitoring является одноразовым анализом.

**Что сделать:**

87. Создай schema strategic_memory с entity scope, statement, evidence links, confidence, version, status, created_at, valid_from/to и supersedes_id.

88. Разрешай запись в memory только после evidence validation и policy approval.

89. Реализуй contradiction detection и lifecycle: active, challenged, superseded, expired.

90. Добавь retrieval памяти по entity, topic и time with provenance.

91. Создай monitoring subscriptions: owner/workspace, condition, baseline, schedule, last_checked_at, last_state, notification policy.

92. Реализуй scheduler/check job с idempotency, cooldown и deduplication уведомлений.

93. Monitoring alert должен содержать changed evidence и сравнение с baseline.

94. Reflection может предложить memory candidate, но не записывает автоматически без validator.

**Критерии готовности:**

- Memory не содержит claim без evidence.

- Обновление не уничтожает историю.

- Monitoring уведомляет только при реальном изменении состояния.

- Повторный check не создаёт дубли.

- Пользователь может отключить subscription.

**Проверка перед деплоем:**

- Проверить migration и RLS/workspace isolation.

- Проверить false alerts, timezone и scheduler reliability.

- Проверить rollback без потери history.

**Риски:**

- Память может усилить старую ошибку; default policy должна быть conservative.

- Monitoring способен создавать расходы; enforce per-workspace quotas и minimum interval.

## Задача 9. Завершить productization и синхронизировать документацию

**ЗАДАЧА ДЛЯ CLAUDE**

**Контекст:** После стабилизации ядра проект должен стать управляемым SaaS-продуктом.

**Текущее состояние:** Документация, версии, environment example и названия функций частично расходятся с кодом; отсутствует завершённый коммерческий контур.

**Что сделать:**

95. Синхронизируй README, ARCHITECTURE, PROJECT_MASTER_DOCUMENTATION и env example с фактическим кодом.

96. Удали или переименуй вводящие в заблуждение термины: Monitoring, Report Generation, Knowledge Graph --- если функциональность ещё не соответствует контракту.

97. Добавь workspaces, roles и RLS isolation.

98. Реализуй saved investigations, report persistence и user-visible citations.

99. Введи plan/usage model, quotas и billing-ready usage ledger без немедленной привязки к конкретному провайдеру оплаты.

100.  Добавь onboarding, admin operations runbook, incident runbook и backup/restore runbook.

101.  Подготовь security/privacy review и data retention policy.

102.  Создай release notes и окончательный architecture decision record.

**Критерии готовности:**

- Документация не противоречит репозиторию.

- Новый инженер может локально поднять проект по README.

- Workspace data изолированы.

- Usage ledger соответствует фактическим AI-вызовам.

- Есть operational runbooks и release notes.

**Проверка перед деплоем:**

- Полный staging acceptance.

- Security review auth/RLS.

- Backup restore drill.

- Load test основных routes и cron.

- Canary release и наблюдение метрик.

**Риски:**

- Не вводить billing до точного usage accounting.

- RLS migration может заблокировать service-role/user flows; тестировать все роли.

- Документацию обновлять после кода в той же фазе, но не описывать будущие функции как уже готовые.

# 8. Release gates и критерии выхода в production

---

**Gate** **Условие прохождения**

---

**Security Gate** Все AI/admin/internal routes защищены; unauthorized запрос не создаёт side effects.

**Type Gate** Type-check, lint и build обязательны и проходят без ignore flags.

**Data Gate** Миграции проверены на staging; есть backup и rollback; транзакционные инварианты подтверждены.

**Quality Gate** Unit/integration/security/golden tests проходят; нет известных P0/P1 regressions.

**AI Integrity Gate** Каждый FACT имеет валидное evidence; invalid output безопасно отклоняется.

**Cost Gate** Rate limit, quotas и budget alerts действуют; известна стоимость типового investigation.

**Observability Gate** Ошибки, latency, token usage, cron и queue state наблюдаемы.

**Performance Gate** P95 latency и timeout укладываются в заданные SLO.

**Documentation Gate** README, env и architecture соответствуют фактическому релизу.

**Rollback Gate** Откат к предыдущей версии и восстановление данных проверены практически.

---

## 8.1. Определение «готово»

Задача не считается выполненной по факту написания кода. Она считается выполненной только когда: изменение реализовано, протестировано, задокументировано, проверено на staging, имеет метрики и rollback, а все критерии конкретной задачи подтверждены выводом команд или воспроизводимым сценарием.

# 9. Протокол совместной работы: владелец --- ChatGPT --- Claude

## 9.1. Роли

- Владелец: утверждает продуктовый приоритет и принимает понятный результат, не управляет техническими деталями.

- ChatGPT: главный архитектор, формирует одну завершённую задачу, анализирует риски, проверяет отчёт и diff Claude.

- Claude: технический исполнитель, читает репозиторий, пишет код, миграции и тесты, не меняет согласованный scope.

## 9.2. Обязательный ответ Claude после каждой задачи

ОТЧЁТ CLAUDE:\

1. Что изменено\
2. Какие файлы изменены\
3. Какие миграции добавлены\
4. Какие тесты добавлены и результат\
5. Результат lint/type-check/build\
6. Что проверено на staging\
7. Остаточные риски\
8. Точный rollback\
9. Commit SHA / PR\
10. Что сознательно не делалось

## 9.3. Запрещённое поведение

- Не выполнять несколько фаз одним огромным PR.

- Не переписывать архитектуру ради удобства без ADR и согласования.

- Не ослаблять типы, auth или validation ради прохождения build.

- Не применять production migration без backup и staging проверки.

- Не скрывать ошибки пустыми catch.

- Не считать красивый LLM-ответ доказательством качества retrieval.

- Не добавлять Multi-Agent до завершения retrieval, evidence и observability.

# 10. Итоговое управленческое решение

Полное решение возможно зафиксировать одним документом --- этот документ выполняет эту функцию. Но реализация не должна выполняться одним запросом или одним pull request. Она должна идти последовательно по девяти фазам с обязательной проверкой после каждой.

Первое действие: передать Claude только «Задачу 0. Зафиксировать baseline и обеспечить безопасную точку отката». После получения его отчёта ChatGPT проверяет фактическое состояние и только затем выдаёт Задачу 1.

Такой порядок не является бюрократией. Он защищает работающий проект от каскадного разрушения, позволяет локализовать ошибки, сохраняет возможность отката и создаёт доказуемую историю роста технической стоимости AIscentra.

# Приложение A. Критические инварианты проекта

103. Ни один неавторизованный запрос не вызывает платный AI и не изменяет данные.

104. Ни один FACT не выдаётся без существующего evidence.

105. Ни один Signal не публикуется без согласованного audit trail.

106. Ни одна migration не применяется без backup и rollback.

107. Ни один production build не проходит с TypeScript-ошибками.

108. Ни одна required execution failure не маскируется успешным report.

109. Ни одна ошибка graph/logging не исчезает бесследно.

110. Ни одна memory запись не существует без provenance и version history.

111. Ни один monitoring alert не отправляется без изменения baseline state.

112. Ни одна новая крупная функция не выходит без telemetry и тестов.

# Приложение B. Карта ожидаемо затрагиваемых областей

---

**Область** **Ожидаемо затрагиваемые части**

---

**API/security** src/app/api/\*\*, middleware/server guards, auth/session, rate limiting

**Runtime** supabase/functions/intelligence-agent/\*\* и связанные runtime/providers

**AI client** Groq client, prompts, schemas, validation, cost controls

**Supabase** migrations, generated types, RPC, RLS, graph/memory/monitoring tables

**Signal Engine** src/modules/signals/\*\*, decision logging, finalization

**Configuration** next.config.ts, tsconfig, package versions, env public/server split

**CI/tests** package scripts, test runner, fixtures, preview checks

**Documentation** README, ARCHITECTURE, master docs, env example, runbooks

---
