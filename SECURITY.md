# Security Policy

## Reporting a vulnerability

Please report suspected security issues by opening an issue in the public GitHub repository:

https://github.com/jdam11/slimventory/issues

Use a clear title such as `Security: <short summary>` and include enough detail to reproduce or understand the concern. Do not include active secrets, private keys, passwords, live tokens, or sensitive data from a real environment.

If the issue involves a working exploit, keep the public report focused on impact, affected area, version, and safe reproduction steps. The maintainer may follow up for more detail if needed.

## Supported versions

Security fixes are handled on the current release line published from this repository. Users should update to the latest tagged release when a fix is available.

## Scope

SLIM is intended for internal infrastructure use and should not be exposed directly to the public internet. Reports about unsafe default deployment patterns, authentication bypasses, secret exposure, authorization bugs, dependency vulnerabilities, and container or reverse-proxy hardening are in scope.
