# Security Policy

## Scope

Agent Change Auditor is a local developer tool. It reads git metadata, diffs, and command output from repositories you choose to audit.

## Reporting

Open a GitHub issue for non-sensitive bugs. For sensitive reports, avoid posting secrets or private diffs publicly; share only minimal reproduction steps and redacted output.

## Secret Handling

The tool redacts common token patterns in generated reports, but it is not a full secret scanner. Do not intentionally commit real API keys, private keys, credentials, command logs with secrets, or private customer data.
