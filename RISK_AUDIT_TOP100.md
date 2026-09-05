# Gemini Bridge 0.4.8.8 — Top-100 risk audit

## Scope and method

This audit was created after repeated real Windows upgrade failures. Risks are sorted primarily by (1) probability on an existing Windows installation, (2) blast radius / data-loss potential, (3) proximity to the Antigravity migration, and (4) ability to regress silently. The first 70 are mandatory checked risks with executable/static contracts in `tests/top70-risk-audit.mjs`; the remaining 30 are ranked residual/environment risks for the next acceptance layer.

`PASS` means the current physical tree satisfies the tested contract. `FIXED + PASS` means the audit confirmed a defect in the prior 0.4.8.5 path, the implementation was changed, and the relevant Top-70 contract passes. It does **not** claim that a Linux container can reproduce Windows Credential Manager, corporate TLS interception, antivirus, or a real browser OAuth session.

## Exact defects confirmed and remediated


18. **Observed on Windows 0.4.8.6:** PowerShell dynamic scope/case-insensitive names allowed script-level `$Source` (release root) to be shadowed by local `$source` (external `agy.exe`), producing `agy.exe\src\managed-antigravity-probe.mjs`. **Fix:** explicit `$script:ReleaseRoot`; external executable renamed `$externalEntry`; copy parameter renamed `$sourceFile`; Phase AI scans critical script-owned roots for shadowing.
19. **Confirmed while fixing #18:** A self-updating user-local Antigravity could change or be transiently locked between source probe and managed copy. **Fix:** bounded candidate probe retries plus up to three fresh managed-copy attempts, each exact-version reprobed; failed candidate directories are removed while the external installation is never mutated.


1. **Observed on Windows:** Single PowerShell Invoke-WebRequest transport failed with `Не удалось создать защищенный канал SSL/TLS`. **Fix:** Added curl.exe HTTPS/TLS1.2 transport, explicit timeouts, TLS1.2 PowerShell fallback; external acquisition now happens before program-tree replacement.
2. **Confirmed by 0.4.8.5 code audit:** Antigravity network acquisition happened after program staging. **Fix:** Reordered transaction: backup state → acquire/verify runtime → stage program.
3. **Confirmed by code audit:** PowerShell installer result depended on `$LASTEXITCODE` after a direct script invocation. **Fix:** Run downloaded PowerShell installer in a fresh powershell.exe process and capture native exit status.
4. **Confirmed by code audit:** Rollback Host launcher inspected stale `$LASTEXITCODE` after `.ps1` invocation. **Fix:** Removed invalid exit-code assumption; subsequent exact health/process checks remain authoritative.
5. **Confirmed by code audit:** New Host launcher had the same stale `$LASTEXITCODE` risk. **Fix:** Same correction; startup acceptance is health/process-identity based.
6. **Confirmed by code audit:** Antigravity discovery could stop at the first stale candidate. **Fix:** Probe all candidates and select only a minimum-version-valid executable.
7. **Confirmed by code audit:** PATH candidate could precede Google's official per-user location. **Fix:** Prefer `%LOCALAPPDATA%\agy\bin\agy.exe`, then PATH candidates.
8. **Confirmed by code audit:** External Antigravity candidate was not screened for reparse/symlink metadata. **Fix:** Reject redirected candidate files before managed copy.
9. **Confirmed by code audit:** Managed agy copy had no transient-lock retry. **Fix:** Bounded exponential retry added; copied binary is exact-version reprobed.
10. **Confirmed by code audit:** Downloaded installer was executed without content/size sanity validation. **Fix:** Reject implausible size and obvious HTML/error-page payloads before execution.
11. **Confirmed by code audit:** Installer download had no explicit bounded timeout. **Fix:** curl connect/max timeout and IWR timeout added.
12. **Confirmed by code audit:** No second official Windows installer transport existed. **Fix:** Use official CMD installer first and official PowerShell installer as independent fallback.
13. **Confirmed by code audit:** Corrupt present host.lock could be treated as if no lock existed during Setup. **Fix:** Present-but-unreadable lock is now fail-closed.
14. **Confirmed by code audit:** Uninstall had the same corrupt-lock fail-open class. **Fix:** Uninstall now refuses an unreadable present lock.
15. **Confirmed by code audit:** StrictMode diagnostics directly dereferenced migrated runtime properties. **Fix:** All legacy optional properties are read through guarded property access and validated explicitly.
16. **Confirmed by code audit:** Auth API allowed repeated launches independent of UI disabled state. **Fix:** Host-level launch cooldown added; UI remains polling-driven.
17. **Confirmed by expanded automatic-variable scan:** `Setup.ps1` still used PowerShell automatic variable name `$args` as the `Shortcut` function parameter. It was not read-only like `$Host`, but shadowing an automatic variable is fragile and makes future refactors error-prone. **Fix:** renamed it to `$shortcutArgs` and strengthened Top70 #17 to reject protected/automatic names in typed declarations as well as assignments.

## Ranked Top-100

| # | Risk zone | Why it ranks here | Audit status |
|---:|---|---|---|
| 1 | TLS/SSL загрузка Antigravity на Windows PowerShell | Это уже проявилось на реальной машине: один Invoke-WebRequest без явного TLS 1.2 ломает весь upgrade. | **FIXED + PASS** |
| 2 | Сетевая зависимость после замены program tree | Если сначала заменить приложение, а затем упасть на сети, приходится откатывать уже затронутую рабочую установку. | **FIXED + PASS** |
| 3 | Нативный exit code PowerShell installer | LASTEXITCODE после прямого .ps1-вызова может быть устаревшим и дать ложный успех/ошибку. | **FIXED + PASS** |
| 4 | Rollback-launcher и устаревший LASTEXITCODE | Ошибка в rollback-пути опаснее обычной ошибки: можно не восстановить рабочий Host. | **FIXED + PASS** |
| 5 | Новый Host launcher и устаревший LASTEXITCODE | Ложная оценка запуска способна откатить исправную установку или принять неудачный старт. | **FIXED + PASS** |
| 6 | Первый найденный agy устарел/сломался | PATH может содержать старый Antigravity, хотя официальный user-local бинарник исправен. | **FIXED + PASS** |
| 7 | Приоритет PATH над официальным user-local Antigravity | Случайный shim/старая копия в PATH не должна побеждать ожидаемый официальный путь. | **FIXED + PASS** |
| 8 | Reparse/symlink для внешнего agy | Копирование через перенаправленный путь может нарушить доверенную runtime-границу. | **FIXED + PASS** |
| 9 | Однократный Copy-Item agy.exe | Антивирус/индексатор может кратко держать файл; один copy создаёт ненужный setup failure. | **FIXED + PASS** |
| 10 | HTML/error page вместо installer script | HTTP 200 от прокси/портала может сохранить HTML и затем попытаться выполнить его как installer. | **FIXED + PASS** |
| 11 | Бесконечная/слишком долгая загрузка installer | Без connect/overall timeout Setup может зависать на нестабильной сети. | **FIXED + PASS** |
| 12 | Единственный transport установки Antigravity | Один сломанный TLS stack или curl/IWR не должен быть единственной точкой отказа. | **FIXED + PASS** |
| 13 | Повреждённый host.lock в Setup трактуется как отсутствие Host | Fail-open здесь может привести к модификации файлов при живом, но неидентифицированном Host. | **FIXED + PASS** |
| 14 | Повреждённый host.lock в Uninstall | Та же fail-open ошибка при удалении может затронуть живую установку. | **FIXED + PASS** |
| 15 | Legacy runtime.json без новых свойств под StrictMode | Это уже ломало 0.4.8.3: старое состояние не обязано иметь provider/geminiEntry/geminiVersion. | **FIXED + PASS** |
| 16 | Повторные POST /v1/auth/start | Без server-side debounce несколько быстрых запросов могут открыть несколько окон авторизации. | **FIXED + PASS** |
| 17 | PowerShell automatic-variable collisions | Регистр не важен: локальные $host/$pid/$home-подобные имена могут конфликтовать с automatic variables и создавать скрытые коллизии. | **FIXED + PASS** |
| 18 | 3- и 4-компонентные версии Bridge | Слишком узкий parser уже блокировал upgrade с 0.4.8.1. | **PASS** |
| 19 | Downgrade protection | Новый гибкий parser не должен случайно разрешить destructive downgrade. | **PASS** |
| 20 | Флаги --skip-path/--skip-aliases в обоих official installers | Bridge не должен неожиданно менять shell profile пользователя. | **PASS** |
| 21 | MANIFEST до любой мутации установки | Повреждённый/подменённый release должен быть отвергнут до остановки или замены program tree. | **PASS** |
| 22 | Antigravity acquisition до Stage-Release | Сетевая ошибка должна оставлять текущую program tree нетронутой. | **PASS** |
| 23 | Backup state до dependency/runtime и program mutation | SQLite/runtime должны иметь точку восстановления до destructive шагов. | **PASS** |
| 24 | Upgrade readiness / unfinished Agent work | Нельзя обновлять при pending Apply/Reconcile/Discard или незавершённых run. | **PASS** |
| 25 | Точная идентичность Host process | PID reuse не должен позволить kill/ожидание чужого процесса. | **PASS** |
| 26 | Offline state check после остановки Host | Перед staging нужно доказать, что SQLite/state консистентны без активного writer. | **PASS** |
| 27 | Rollback при first-install failure | Первая установка не должна оставлять полусобранную program tree. | **PASS** |
| 28 | Rollback mutable extension | Pairing config/extension не должны остаться от незафиксированной версии. | **PASS** |
| 29 | Rollback launcher | Автозапуск должен соответствовать восстановленной версии, а не failed candidate. | **PASS** |
| 30 | Exact-version reprobe managed agy | После копирования нужно доказать, что запускается именно ожидаемый runtime, а не только source. | **PASS** |
| 31 | geminiEntry остаётся внутри RuntimeBase | runtime.json не должен направить Host на внешний/подменённый executable. | **PASS** |
| 32 | Атомарная запись runtime.json | Crash между truncate/write не должен оставлять обрезанный конфиг. | **PASS** |
| 33 | Неизвестный runtime provider | Host должен fail-closed на неожиданном provider вместо молчаливого fallback. | **PASS** |
| 34 | Сохранение pairing token при repair | Repair не должен без причины разрывать Dashboard/extension pairing. | **PASS** |
| 35 | Свободный loopback port | Port collision не должен приводить к запуску на неверном адресе/порту или непонятному состоянию. | **PASS** |
| 36 | Retention old runtimes/backups | Обновления не должны бесконечно раздувать LOCALAPPDATA и одновременно не должны удалять rollback слишком рано. | **PASS** |
| 37 | Server-side auth launch cooldown | UI-disable недостаточно: API может быть вызван напрямую/дважды. | **PASS** |
| 38 | Token gate на auth endpoints | Локальный чужой процесс не должен запускать/читать auth flow без pairing token. | **PASS** |
| 39 | Host/Origin gate loopback API | Browser-origin requests не должны превращать локальный Host в CSRF-поверхность. | **PASS** |
| 40 | Bounded auth status probe | Зависший provider/keyring probe не должен зависить Dashboard/Host. | **PASS** |
| 41 | Изоляция Antigravity HOME/USERPROFILE | Bridge policy/settings должны жить в app-owned profile, не смешиваясь с произвольным CLI profile. | **PASS** |
| 42 | App-owned Antigravity settings path | Permissions должны применяться к тому профилю, который реально запускает managed agy. | **PASS** |
| 43 | Ask = default | Ask не должен случайно стать plan/read-only; такая регрессия уже была найдена при миграции. | **PASS** |
| 44 | Review = plan | Review обязан оставаться без записи в snapshot/live workspace. | **PASS** |
| 45 | Agent Edit = accept-edits только в snapshot | Edit должен уметь менять только отдельную sanitized copy до explicit Apply. | **PASS** |
| 46 | stream-json input/output pair | Неправильная комбинация форматов теряет turns или зависает в headless режиме. | **PASS** |
| 47 | Канонический user event shape | Protocol drift на stdin может сделать запросы молча неисполняемыми. | **PASS** |
| 48 | Отсутствующий terminal result | Нельзя считать частичный stream успешным без финального result. | **PASS** |
| 49 | ERROR/CANCELED/INVALID terminal result | Exit 0 сам по себе не равен успешному ответу provider. | **PASS** |
| 50 | Bounded final output | Неограниченный ответ может исчерпать память/SQLite/UI. | **PASS** |
| 51 | Bounded raw stream | Tool transcript ограничен 32 MiB, чтобы provider не мог раздувать процесс без контроля. | **PASS** |
| 52 | Bounded stderr diagnostics | Ошибочный provider не должен создавать неограниченный diagnostic payload. | **PASS** |
| 53 | Windows taskkill process tree | Cancel/shutdown должны завершать именно дерево managed process, не оставляя orphan. | **PASS** |
| 54 | Запрет command(*) | Agent Edit не должен получать shell execution. | **PASS** |
| 55 | Запрет read_url/execute_url | Внешняя сеть не нужна для локального snapshot-edit и увеличивает exfiltration surface. | **PASS** |
| 56 | Запрет MCP | Неизвестные внешние tools не должны обходить Bridge safety boundary. | **PASS** |
| 57 | Запрет unsandboxed(*) | Нельзя разрешать provider bypass встроенных ограничений. | **PASS** |
| 58 | allowNonWorkspaceAccess=false | Antigravity не должен читать/писать вне активной sanitized workspace. | **PASS** |
| 59 | Ask запрещает file read/write | Обычный разговор не должен неожиданно видеть локальный проект. | **PASS** |
| 60 | Review запрещает write_file | Анализ не должен мутировать даже sanitized snapshot. | **PASS** |
| 61 | Ask cwd отдельно от project snapshot | Даже implicit workspace auto-allow не должен раскрывать проект в Ask. | **PASS** |
| 62 | Snapshot исключает .git/secrets/build/deps | Копия для модели должна минимизировать секреты, бинарники и огромные dependency trees. | **PASS** |
| 63 | Symlink/junction skip в snapshot | Ссылка внутри проекта не должна вытянуть файлы за workspace. | **PASS** |
| 64 | Depth/file-count/byte limits snapshot | Злонамеренный/гигантский project tree не должен DoS-ить Bridge. | **PASS** |
| 65 | Apply CAS baseline hashes | Live файл, изменённый после snapshot, нельзя перезаписывать без конфликта. | **PASS** |
| 66 | Reconcile applied/pending/conflict classification | Interrupted Apply должен быть восстановим без угадывания, что уже записано. | **PASS** |
| 67 | Discard semantics | Discard удаляет pending snapshot, но не должен ложно обещать rollback уже применённых файлов. | **PASS** |
| 68 | Management locks Apply/Reconcile/Discard | Конкурирующие management operations не должны гоняться за одним run/workspace. | **PASS** |
| 69 | Shutdown waits runs/process slots/management | Host не должен завершаться посреди Apply/Reconcile/Discard. | **PASS** |
| 70 | requestId idempotency | Повторная доставка того же запроса не должна создавать второй run; другой payload с тем же key должен быть отвергнут. | **PASS** |
| 71 | Dashboard CSP/token leakage | UI не должен утекать pairing token через DOM, внешние ресурсы или небезопасный script path. | **RANKED / outside mandatory Top-70** |
| 72 | Mutable extension config isolation | Generated pairing config должен оставаться вне immutable program tree и release manifest. | **RANKED / outside mandatory Top-70** |
| 73 | Extension route binding to correct tab/project | Панель не должна случайно переносить context между вкладками ChatGPT. | **RANKED / outside mandatory Top-70** |
| 74 | Closed Shadow DOM | Изоляция панели снижает конфликт CSS/DOM с ChatGPT. | **RANKED / outside mandatory Top-70** |
| 75 | UI duplicate-click/disabled states | Кнопки Send/Auth/Apply должны быть устойчивы к double-click и latency. | **RANKED / outside mandatory Top-70** |
| 76 | Actionable error UX | Ошибки должны сохранять Retry/Reconnect/Details, а не превращаться в generic Failed. | **RANKED / outside mandatory Top-70** |
| 77 | Dark/responsive/accessibility | Product polish не должен ухудшать keyboard/focus/reduced-motion/small-screen поведение. | **RANKED / outside mandatory Top-70** |
| 78 | Project/thread state integrity | Переключение project/thread во время run не должно смешивать историю. | **RANKED / outside mandatory Top-70** |
| 79 | Manifest exhaustive file set | Новые test/doc/source files легко забыть добавить в release checksum contract. | **RANKED / outside mandatory Top-70** |
| 80 | Freeze vs clean extraction identity | ZIP должен воспроизводить именно протестированное freeze tree. | **RANKED / outside mandatory Top-70** |
| 81 | Transient release pollution | .git/node_modules/temp/runtime state не должны попасть в release. | **RANKED / outside mandatory Top-70** |
| 82 | Docs/version consistency | Инструкции не должны отправлять пользователя в старый Gemini CLI или sign-in shortcut. | **RANKED / outside mandatory Top-70** |
| 83 | Node 22/24 compatibility | Разные поддержанные Node major/minor могут отличаться в process/sqlite поведении. | **RANKED / outside mandatory Top-70** |
| 84 | winget Node install failures | Источник/политика winget может быть недоступна на корпоративном Windows. | **RANKED / outside mandatory Top-70** |
| 85 | Non-admin install | Setup обещает current-user установку и не должен незаметно требовать elevation. | **RANKED / outside mandatory Top-70** |
| 86 | Unicode Windows paths | Имя пользователя/проект/Temp могут содержать кириллицу и другие Unicode символы. | **RANKED / outside mandatory Top-70** |
| 87 | Spaces/quotes in paths | Program Files, Desktop и проекты часто содержат пробелы; quoting должен оставаться точным. | **RANKED / outside mandatory Top-70** |
| 88 | TEMP path edge cases | Installer temp path может содержать spaces, policy redirects или нестандартный диск. | **RANKED / outside mandatory Top-70** |
| 89 | Long Windows paths | Глубокие project/runtime paths могут упереться в Win32 path limits/policy. | **RANKED / outside mandatory Top-70** |
| 90 | HTTP(S)_PROXY environment | Корпоративный proxy меняет TLS/download/provider поведение. | **RANKED / outside mandatory Top-70** |
| 91 | Corporate TLS / custom CA | Даже TLS1.2 не гарантирует доверие цепочке сертификатов за SSL inspection. | **RANKED / outside mandatory Top-70** |
| 92 | Antivirus/EDR file locks | Runtime/program rename/copy может кратковременно блокироваться защитным ПО. | **RANKED / outside mandatory Top-70** |
| 93 | ACL/read-only directories | LOCALAPPDATA или restored files могут иметь неожиданные ACL/attributes. | **RANKED / outside mandatory Top-70** |
| 94 | Disk-full during backup/staging | Недостаток места должен давать безопасный rollback без потери исходных файлов. | **RANKED / outside mandatory Top-70** |
| 95 | Pending reboot/file replacement | Windows Update/installer состояния могут менять возможность rename/delete. | **RANKED / outside mandatory Top-70** |
| 96 | Multiple Windows users | Per-user runtime/credentials/Startup shortcuts не должны пересекаться. | **RANKED / outside mandatory Top-70** |
| 97 | Credential Manager policy/lockout | Enterprise policy может запретить keyring и auth должен сообщить это явно. | **RANKED / outside mandatory Top-70** |
| 98 | Нет default browser | Interactive OAuth launch может быть невозможен в kiosk/headless profile. | **RANKED / outside mandatory Top-70** |
| 99 | Upstream Antigravity stream protocol drift | Google может изменить event schema/terminal statuses и нужен fail-closed parser. | **RANKED / outside mandatory Top-70** |
| 100 | Upstream installer URL/flags drift | Google может изменить install.cmd/install.ps1 или flags; Setup должен падать безопасно и диагностично. | **RANKED / outside mandatory Top-70** |

## Top-70 execution contract

The 70 mandatory checks are one-to-one named `Top70 #01` … `Top70 #70`. They cover Windows setup/dependency acquisition, legacy migration, rollback/uninstall, process ownership, runtime config, Antigravity transport/auth/safety policy, bounded stream parsing, snapshot/apply/reconcile safety, shutdown management and request idempotency.

The Top-70 gate must be re-run from the final clean ZIP extraction. Any release-facing change requires regeneration of `MANIFEST.sha256` before Phase AB is considered valid.

## Residual risks 71–100

These are deliberately not presented as fully closed by the Top-70 audit. Several are already partially covered by inherited UX/security tests, but their decisive evidence depends on actual Windows/browser/enterprise conditions (for example proxy TLS inspection, EDR locks, Credential Manager policy, default browser availability, and upstream Google changes). They remain ranked so the next real-Windows acceptance cycle has a concrete queue instead of discovering them reactively.
