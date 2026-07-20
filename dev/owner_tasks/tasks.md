# Owner Task Board

<!-- One task per canonical line (see dev/owner_tasks/README.md for the grammar):
       - [<box>] #<NNN> [area:<tag>] added:<YYYY-MM-DD> [done:<YYYY-MM-DD>] needs:<-|NNN[,NNN...]> :: <title>
     Marked done in place — nothing is deleted; `tasks.sh log` shows history.
     Optional indented "> " lines below a task are free-text notes, preserved untouched.
     Only the OWNER marks tasks done. Agents may add tasks, and only when explicitly asked. -->

- [x] #001 area:pokemon added:2026-07-19 done:2026-07-20 needs:- :: Add non-legendary mega pokemon
- [x] #002 area:pokemon added:2026-07-19 done:2026-07-20 needs:001 :: Add baby pokemon and link them to their respective megas
   > Depends on #001 — megas must exist before babies can link to them.
- [x] #003 area:pokemon added:2026-07-19 done:2026-07-20 needs:- :: Add rotom
- [x] #004 area:pokemon added:2026-07-19 done:2026-07-20 needs:- :: Add future and past pokemon for some more artificial and fossil legendaries/event pokemon
- [ ] #005 area:framework added:2026-07-19 needs:- :: Tell Claude to create a framework for event-only pokemon
   > Still designing this — do NOT implement yet; will brief an agent later.
- [ ] #006 area:events added:2026-07-19 needs:- :: Add location-specific and pokemon-specific events (including for legendaries)
- [ ] #007 added:2026-07-20 needs:- :: More dual-typed moves
- [ ] #008 added:2026-07-20 needs:- :: Confirm every type has base set of usable moves
- [ ] #009 added:2026-07-20 needs:- :: Change gym leaders and elites to use megas instead of legendaries
