# Hourly Batch Delivery Implementation Plan

**Goal:** Replace the one-run 200-job limit with serial hourly rounds that preload at most 50 unseen job links, process one JD at each pacing slot, greet it immediately when qualified, then process resume requests once before another round may start.

**Architecture:** Keep orchestration in the search-page userscript. One controller promise runs a single state machine: wait for an eligible hour, search and preload job links, process one JD at each scheduled slot (detail, score, immediate greeting), process resume requests, then wait for the next top-of-hour boundary. There is no qualified-job queue. Missed slots and hours are never replayed. Runtime-only sets provide deduplication; refreshing the program resets them.

**Tech Stack:** Tampermonkey JavaScript, BroadcastChannel/localStorage worker coordination, Python unittest with Node-based scheduler checks.

---

### Task 1: Replace Run Limits With Round Configuration

**Files:** `config.py`, `user_config.example.json`, `web_script.js`, `test_single_route_backend.py`

- Add `schedule.jobsPerRound = 50`.
- Remove `frontend.maxJobsPerRun` and the `minPerHour` / `maxPerHour` delivery target.
- Keep `testIntervalSeconds` as the explicit fixed-interval test override.

### Task 2: Make Pacing Depend on Candidate Count

**Files:** `web_script.js`, `test_single_route_backend.py`

- Pass the number of preloaded candidate jobs into the hourly scheduler.
- Preserve all five pacing strategies while generating exactly that many ordered slots.
- Keep test mode at one JD polling operation per configured interval.
- Discard an expired slot without reading or deduplicating its corresponding job, and never catch up by processing multiple jobs together.

### Task 3: Build the Serial Round State Machine

**Files:** `web_script.js`, `test_single_route_backend.py`

- Collect at most 50 unique, previously unseen job links for one round without opening their details during preload.
- At each valid slot, claim one job key, read its detail, score it, and greet it immediately when qualified.
- Do not build a qualified-job queue or defer greetings until all JDs have been scored.
- Wait for each detail and greeting worker result before moving to the next scheduled slot.
- Run one resume-request worker after delivery and wait for its completion receipt.
- End the resume-request phase once its worker times out or is blocked; do not retry automatically.
- Do not start another round before resume processing completes.
- Skip missed historical hours instead of catching up.

### Task 4: Preserve Stop and Restart Behavior

**Files:** `web_script.js`, `test_single_route_backend.py`

- Check the shared stop state in preload, detail reading, scoring, slot waiting, greeting, and resume processing.
- Keep deduplication in page memory so a page/program restart starts fresh.
- Add a job to the deduplication set only when its valid slot begins actual processing; expired slots do not consume jobs.
- Do not persist round state in SQLite or local files.

### Task 5: Documentation and Verification

**Files:** `README.md`

- Document the 50-job hourly round, per-JD polling separator, immediate greeting, expired-slot handling, and post-delivery resume scan.
- Run JavaScript syntax checks, the complete Python/Node test suite, Python compilation, JSON/default-config parity, and `git diff --check`.
