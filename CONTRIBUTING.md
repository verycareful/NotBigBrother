# Contributing to NotBigBrother

First: thank you. This project exists because we believe surveillance-based age verification needs a real alternative. Every person who reads the code, files a bug, or submits a fix makes that alternative more credible.

---

## A note on who we are

We're two undergraduate students. We are not seasoned engineers. We got angry about something and tried to do something about it.

There are parts of this codebase we don't fully understand. There are patterns we followed because they seemed right, not because we've been writing cryptographic systems for ten years. We used AI to help fill gaps in our knowledge, which means some of the code is competent but not necessarily wise.

This is not false modesty. It's a warning: **do not assume the existing code is correct just because it works.** If you know better — about cryptography, systems design, privacy guarantees, whatever — your knowledge is more valuable here than ours. Use it.

---

## What good contributions look like

### Write code that the next person can actually read

We will not always understand what you've done. That's not an excuse for us to be slow reviewers — it's a reason for you to explain your work clearly. If we can't understand a PR, we can't merge it responsibly, and this project is too sensitive to merge things we don't understand.

**Name things clearly.** `blindedToken` is better than `bt`. `isAgeVerified` is better than `flag`. `verifySignatureWithPublicKey` is better than `check`. If a variable name requires a comment to explain, the variable name is wrong.

**Don't be clever.** Cryptographic code that is elegant but opaque is a liability. We'd rather have ten lines of readable code than three lines of impressive code that takes twenty minutes to parse.

**Leave the code better than you found it.** If you touch a file and there's something confusing nearby, fix it or file an issue. Don't walk past broken windows.

### Document what isn't obvious

We don't mean "add a JSDoc comment to every function." We mean: if you made a non-obvious decision, explain it. If you implemented a particular scheme because the alternatives have known weaknesses, say that. If there's a subtle invariant the caller has to maintain, write it down.

The people who come after you — including us — will not have your context. Give them enough to not break what you built.

### Tests are not optional

If you add behavior, test it. If you fix a bug, add a test that would have caught it. The test suite is how we know things still work when someone who doesn't understand the whole system makes a change. That someone will often be us.

---

## Privacy and security bugs

If you find a flaw in the cryptography, a loophole in the privacy model, a way tokens could be linked to identities, a way the double-blind guarantee could break — **open an issue immediately.** Mark it as a security issue. Do not fix it silently in a PR without a corresponding issue.

Privacy bugs are treated as critical vulnerabilities. We take them seriously even if we don't always have the expertise to fully evaluate them on first read. Especially then, actually.

---

## What we ask in general

- **Be honest about what you know and don't know.** A PR that says "I think this is right but I'm not sure about X" is more useful than one that quietly papers over uncertainty.
- **Be direct.** If something in the codebase is wrong or naive, say so. We won't be offended. We'd rather hear it from a contributor than discover it after deployment.
- **Be patient.** We're students. We have exams. Reviews may be slow. This is not a sign of disinterest.
- **Be kind, but not soft.** This project has a purpose. Bad code, vague documentation, and undocumented assumptions are real risks here, not just aesthetic problems. Hold the work to a real standard.

---

## Getting started

```bash
git clone https://github.com/Zonde246/NotBigBrother
cd NotBigBrother
npm install
npm run dev
```

Check the open issues for things that need doing. If you have an idea that isn't in the tracker, open an issue before you start building — we'd rather align early than review something that goes in a direction we can't support.

---

*We're not building a finished product. We're building a starting point worth improving. Make it better than we left it.*
