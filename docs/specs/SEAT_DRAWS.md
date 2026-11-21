# Seat draws

Enrollment › Merit & Seat Allocation for schools (rule book §13.1, §16.2; P1 item 20). Owned by
school/admissions.

- **Draw** (`school.admission.manage`): one class and category of an admission year, once seats
  are set. In the draw: applications still open for an offer (applied, papers pending, under
  review, waitlisted). Left out, with the reason shown: an age outside the rule pack without an
  override; an RTE application not from the RTE portal.
- **Order**: lottery by SHA-256 of `seed:application id`, or first come by when they applied;
  optionally siblings first, each group in that order. The seed is typed (numbers drawn in front of
  parents) or random, and recorded either way with the frozen inputs, so the draw can be run again
  and must give the same order; the screen shows whether it does.
- **Publish** (`school.admission.offer`, never the person who drew it): in order, applicants still
  open get offers while seats last (fee plan disclosed, 7 days to accept, as any offer); the rest
  are waitlisted with their rank, which the lapsed-offer rule then follows.
- **Set aside**: with a reason. Every draw stays on record, so a re-draw can't hide one that was
  set aside. One undecided draw per class and category at a time. A database trigger keeps the
  seed, inputs and order from changing.

Not yet: college merit lists from the rule pack (eligibility, merit score, counselling rounds,
seat matrix by category and quota), interaction slots for schools, allotment letters.
