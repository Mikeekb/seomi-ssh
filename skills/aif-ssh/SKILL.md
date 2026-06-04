---
name: aif-ssh
description: Use the SSH access that `seomi-ssh init` configured for this project — run remote commands, deploy files (scp/rsync), and diagnose servers. Connection parameters live in `.claude/.env` under SSH_<ROLE>_* keys. Trigger when the task needs work on a remote server (deploy, run a command remotely, tail logs, check disk/service status) or when the user mentions prod/dev/staging access.
---

# aif-ssh — использование SSH-доступа агентом

Этот проект настроен через `@seomi/ssh`: для одного или нескольких серверов уже
сконфигурирован беспарольный SSH-доступ (ed25519-ключ), а реквизиты записаны в
`.claude/.env`. Этот skill учит, как этим доступом пользоваться.

## Где брать реквизиты доступа

**Первое и единственное место — `.claude/.env`.** Не используй `~/.ssh/config`, алиасы из
других проектов и не угадывай host по имени проекта.

Каждый сервер описан группой ключей с префиксом роли:

```
SSH_SERVERS=PROD,DEV              # реестр настроенных серверов (csv префиксов)

SSH_PROD_HOST=prod.example.com
SSH_PROD_USER=ai-agent
SSH_PROD_PORT=22
SSH_PROD_KEY=~/.ssh/id_ed25519
SSH_PROD_ROOT=/var/www/app        # необязательный — рабочая директория
```

Алгоритм: прочитай `SSH_SERVERS`, выбери нужный префикс (`PROD` / `DEV` / кастомный),
подставь `SSH_<PREFIX>_HOST/USER/PORT/KEY/ROOT` в команды ниже.

## Готовые команды

Пусть `H=$SSH_<PREFIX>_HOST`, `U=$SSH_<PREFIX>_USER`, `P=$SSH_<PREFIX>_PORT`,
`K=$SSH_<PREFIX>_KEY`, `R=$SSH_<PREFIX>_ROOT`. Флаг порта добавляй только если порт ≠ 22.

```bash
# Выполнить команду на сервере
ssh -p "$P" -i "$K" "$U@$H" "<command>"

# Скопировать файл/каталог на сервер (порт у scp — заглавная -P)
scp -P "$P" -i "$K" -r ./local-path "$U@$H:$R/"

# Инкрементальная синхронизация каталога (предпочтительно для повторных деплоев)
rsync -avz -e "ssh -i $K -p $P" ./local-dir/ "$U@$H:$R/"

# Просмотр логов / статуса
ssh -p "$P" -i "$K" "$U@$H" "tail -n 100 $R/storage/logs/app.log"
```

## Правила

- **`.claude/.env` — источник истины.** Если ключа нет в `.claude/.env`, доступ к этому
  серверу не настроен — не выдумывай реквизиты, предложи запустить `seomi-ssh init`.
- **Не логируй и не выводи содержимое приватного ключа** (`$SSH_<PREFIX>_KEY` указывает на
  файл — путь показывать можно, содержимое — нет).
- **Деплой через SSH/scp/rsync — канонический путь.** Не предлагай GUI-клиенты
  (PhpStorm/WebStorm Deploy, Cyberduck, FileZilla) первым вариантом.
- **Перед разрушительными операциями на сервере** (`rm -rf`, перезапись, миграции БД,
  рестарт сервисов) — подтверди у пользователя; одобрение для одного сервера не
  распространяется на другие.
- **Не путай окружения.** Перед командой на `PROD` убедись, что выбран правильный префикс;
  для экспериментов предпочитай `DEV`/`staging`, если он настроен.

## Управление доступом

- `seomi-ssh init` — первичная настройка (добавить серверы, скопировать ключ, записать блок).
- `seomi-ssh update` — перегенерировать managed-блок в `AGENTS.md`/`CLAUDE.md` после
  изменения реквизитов в `.claude/.env`.
- `seomi-ssh doctor` — проверить, какие серверы настроены и доступны ли они по ключу.
