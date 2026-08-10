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
- [x] #005 area:framework added:2026-07-19 done:2026-07-20 needs:- :: Tell Claude to create a framework for event-only pokemon
   > Still designing this — do NOT implement yet; will brief an agent later.
- [x] #006 area:events added:2026-07-19 done:2026-07-22 needs:- :: Add location-specific and pokemon-specific events (including for legendaries)
- [x] #007 added:2026-07-20 done:2026-07-20 needs:- :: More dual-typed moves
- [x] #008 added:2026-07-20 done:2026-07-20 needs:- :: Confirm every type has base set of usable moves
- [x] #009 added:2026-07-20 done:2026-07-20 needs:- :: Change gym leaders and elites to use megas instead of legendaries
- [x] #010 added:2026-07-20 done:2026-08-10 needs:- :: Download backgrounds
- [x] #011 added:2026-07-20 done:2026-07-20 needs:- :: Fix gym leaders
- [x] #012 added:2026-07-20 done:2026-07-31 needs:- :: check ace trainers
- [x] #013 added:2026-07-20 done:2026-07-31 needs:- :: check event trainers
- [x] #014 added:2026-07-20 done:2026-08-01 needs:- :: check standards
- [x] #015 added:2026-07-22 done:2026-07-31 needs:- :: Create event for Articuno
- [x] #016 added:2026-07-22 done:2026-07-31 needs:- :: Create event for Zapdos
- [x] #017 added:2026-07-22 done:2026-07-31 needs:- :: Create event for Moltres
- [x] #018 added:2026-07-22 done:2026-07-22 needs:- :: Create events for Regis
- [x] #019 added:2026-07-22 done:2026-07-31 needs:- :: Create event for Mewtwo
- [x] #020 added:2026-07-22 done:2026-07-31 needs:- :: Create event for Entei
- [x] #021 added:2026-07-22 done:2026-07-31 needs:- :: Create event for Raikou
- [x] #022 added:2026-07-22 done:2026-07-31 needs:- :: Create event for Suicune
- [x] #023 added:2026-07-22 done:2026-07-31 needs:- :: Create event for Celebi
- [x] #024 added:2026-07-22 done:2026-07-31 needs:- :: Create event for Lugia
- [x] #025 added:2026-07-22 done:2026-07-31 needs:- :: Create event for Ho-oh
- [x] #026 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Dialga
- [x] #027 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Palkia
- [x] #028 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Giratina
- [x] #029 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Darkrai
- [x] #030 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Volcarona
- [x] #031 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Cobalion
- [x] #032 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Terrakion
- [x] #033 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Virizion
- [x] #034 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Reshiram
- [x] #035 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Zekrom
- [x] #036 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Kyurem
- [x] #037 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Keldeo
- [x] #038 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Xerneas
- [x] #039 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Yveltal
- [x] #040 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Tapu Koko
- [x] #041 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Tapu Bulu
- [x] #042 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Tapu Lele
- [x] #043 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Tapu Fini
- [x] #044 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Tapu Okidogi
- [x] #045 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Tapu Munkidori
- [x] #046 added:2026-07-22 done:2026-08-10 needs:- :: Create event for Tapu Fezandipiti
- [x] #047 added:2026-07-22 done:2026-07-31 needs:- :: Create event for rotom-heat conversion
- [x] #048 added:2026-07-22 done:2026-07-31 needs:- :: Create event for rotom-wash conversion
- [x] #049 added:2026-07-22 done:2026-07-31 needs:- :: Create event for rotom-frost conversion
- [x] #050 added:2026-07-22 done:2026-07-31 needs:- :: Create event for rotom-fan conversion
- [x] #051 added:2026-07-22 done:2026-07-31 needs:- :: Create event for rotom-mow conversion
- [ ] #052 added:2026-07-22 needs:- :: Create events for future pokemon
- [ ] #053 added:2026-07-22 needs:- :: Create event for future archaludon
- [x] #054 added:2026-07-31 done:2026-08-01 needs:- :: Events to give artificial items or attacks
- [ ] #055 added:2026-07-31 needs:- :: More attacks for each type with stat-changing effects
- [ ] #056 added:2026-08-03 needs:- :: Too many human type trainers
