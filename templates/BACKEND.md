# Backend guide

How the backend of this project is built. The backend agent follows it, and the reviewer checks
against it. It describes a normal, conventional structure, the kind most production apps use. The
owner may edit this file for this project, and the edited version wins.

Rules marked **(security)** are never skipped. Anything else may change if the API contract or the
owner asks for something different.

## Stack

- Node.js LTS with TypeScript in strict mode, unless the owner chose something else.
- A mainstream HTTP framework: Express, Fastify, or NestJS. Pick one and use it the usual way.
- The database, and whether to use an ORM, a query builder, or plain SQL, is decided for this
  project. If nothing was decided, use SQLite for local work through a well-known driver, and keep
  all queries in repositories so it can be swapped later.
- Pin dependency versions through the lockfile, and keep the dependency list short. Every package
  must be well known and maintained. Never add a package to do something a few lines of code can do.

## Structure

Organize by feature, with the same layers inside every feature:

```text
backend/
  src/
    app.ts                  builds the app: middleware, routes, error handler (no listen)
    server.ts               starts listening and handles shutdown
    config/                 reads and validates environment variables, once, at startup
    modules/
      <feature>/            for example users/, orders/, invoices/
        <feature>.routes.ts       URLs and which middleware runs
        <feature>.controller.ts   reads the request, calls the service, sends the response
        <feature>.service.ts      business rules; no request or response objects here
        <feature>.repository.ts   the only place that talks to the database
        <feature>.schemas.ts      input and output validation schemas
        <feature>.test.ts
    middleware/             auth, validation, rate limits, request id, error handler
    lib/                    shared helpers: logger, errors, db connection
  migrations/               database changes, numbered, never edited after they ship
  tests/                    integration tests that call the real HTTP endpoints
  .env.example              every variable, with safe example values and no real secrets
  package.json              scripts: dev, build, start, test, lint, typecheck
```

- Requests flow one way: route, then controller, then service, then repository. A layer never calls
  the one above it.
- Features talk to each other only through each other's services, never through each other's
  repositories or tables.
- Small projects may merge files, but never put database queries in a controller or route.

## Configuration

- Read every setting from environment variables in `config/`, validate them with a schema at
  startup, and stop with a clear message if one is missing or wrong. Nothing else reads
  `process.env`.
- **(security)** No secret in code, tests, logs, or committed files. `.env` is in `.gitignore`.
- Safe defaults: if a setting is missing in development, the app runs in its safest mode, never
  with checks turned off.

## Input and output

- **(security)** Validate every input (body, params, query, headers that are used) with a schema
  library such as Zod, before it reaches the service. Reject unknown fields. Set limits on string
  length, array size, and number range.
- **(security)** Limit request body size (for example 100kb for JSON) and file upload size and
  type. Check uploaded files by content, store them outside the code folder, give them generated
  names, and never serve them from a path the user chose.
- **(security)** Responses go through an output schema or an explicit field list. Never send a
  database row as is: no password hashes, internal ids the client does not need, or other users'
  data.
- Follow `docs/API_CONTRACT.md` exactly: the same paths, fields, status codes, and error shape.
- Lists are paginated with a maximum page size. No endpoint returns an unbounded list.

## Errors

- One error class (for example `AppError` with status, code, and message) and one central error
  handler. Controllers pass errors on; they do not format error responses themselves.
- Error responses have one shape, for example `{ "error": { "code": "NOT_FOUND", "message": "..." } }`.
- **(security)** Clients never see stack traces, SQL, file paths, or library messages. Unknown
  errors become a 500 with a generic message, and the details go to the log.
- Async errors are always caught: use the framework's async support or a wrapper, and always
  `return await` inside try blocks.
- Handle `unhandledRejection` and `uncaughtException`: log them, close the server cleanly, and
  exit with a non-zero code.

## Data

- **(security)** Only parameterized queries or the query builder's bound values. Never build SQL,
  or a NoSQL filter, by joining strings with user input.
- Changes that touch more than one row or table that must stay consistent run in a transaction.
- Schema changes are migrations in `migrations/`. The app never changes the schema by itself at
  runtime, apart from running pending migrations at startup if the owner wants that.
- Add the indexes the queries need, and unique constraints for anything that must be unique, so the
  database enforces it even if the code has a bug.
- Money is stored as integer minor units (cents, paisa) or a decimal type, never as a float.
- Dates are stored in UTC.

## Accounts and access (only if the project has users)

Login is not added unless the contract or the owner asks for it. When it is:

- **(security)** Passwords hashed with argon2id, or bcrypt with cost 12 or more. Never stored or
  logged in plain text.
- **(security)** Sessions in httpOnly, Secure, SameSite cookies, or short-lived access tokens with
  refresh tokens that can be revoked. Tokens are never put in URLs or logs.
- **(security)** Rate-limit login, signup, and password reset, and lock or slow down after
  repeated failures. The same message for "wrong email" and "wrong password".
- **(security)** Check ownership on every request that names a record: the record must belong to
  the current user, or the user's role must allow it. Do this in the service or repository, for
  every endpoint, not only in the frontend. This is the most common API flaw (broken object-level
  authorization).
- **(security)** Check the role for every admin or privileged action on the server.
- **(security)** A client can never set its own role, owner, price, balance, or status fields:
  pick the allowed fields explicitly instead of copying the request body into the record.
- If cookies carry the session, protect state-changing requests against CSRF.

## HTTP hardening

- **(security)** Security headers with helmet or the framework's equivalent. Remove the
  `X-Powered-By` header.
- **(security)** CORS allows only the frontend's origin from config, never `*` with credentials.
- **(security)** A general rate limit on the whole API, and stricter limits on expensive or
  sensitive endpoints.
- **(security)** If the server fetches a URL that a user supplied, allow only expected hosts and
  block private and local addresses (SSRF).
- **(security)** No `eval`, `new Function`, or `child_process` with user input. No regular
  expressions that can take exponential time on crafted input.
- Timeouts on every outgoing request and database query.
- Remove routes that are not in the contract, including framework demo or debug routes.

## Safe on the owner's computer

The backend runs on the owner's laptop during development, so it must never harm that machine:

- **(security)** In development, listen on `127.0.0.1`, not `0.0.0.0`, unless the owner asks for
  access from other devices.
- **(security)** Read and write files only inside the project folder, or inside a data folder set
  in config. Resolve every path and refuse any that leaves that folder.
- **(security)** No install scripts (`postinstall` and similar) that download or run anything, and
  no scripts that delete or change files outside the project.
- Test commands use a separate test database or an in-memory one, and never touch the development
  data.
- The server shuts down cleanly on Ctrl+C: stop accepting requests, finish the ones running, close
  the database, then exit.

## Logging and health

- A real logger (pino or similar), as structured JSON in production and readable text in
  development. No `console.log` in finished code.
- Every request gets a request id, included in its log lines and in error responses.
- **(security)** Redact passwords, tokens, cookies, and authorization headers in logs.
- `GET /health` returns 200 when the app and its database are reachable, without exposing details.

## Tests

- Unit tests for services, with the repository replaced where that keeps them simple.
- Integration tests that call the HTTP endpoints against a test database, covering for each
  endpoint: the success case, invalid input (400), missing login (401) and wrong owner (403 or 404)
  where accounts exist, and not found (404).
- Tests do not depend on each other or on their order, and leave no data behind.
- `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all pass before the step is
  done.

## Before calling it done

- [ ] Every endpoint in `docs/API_CONTRACT.md` exists, with the same fields and status codes
- [ ] Every input is validated, and every response sends only the fields in the contract
- [ ] No SQL or filters built from strings, and every record lookup checks ownership (if accounts exist)
- [ ] No secrets in code, logs, or committed files, and `.env.example` lists every variable
- [ ] Errors use one shape and never leak internals
- [ ] Security headers, CORS, body limits, and rate limits are on
- [ ] Listens on 127.0.0.1 in development and touches no files outside the project
- [ ] Tests, lint, typecheck, and build pass
