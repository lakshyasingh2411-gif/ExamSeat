// Pure seat-planning logic: interleave departments, then fill rooms in order.
function plan(students, rooms) {
  const groups = {};
  [...students].sort((a, b) => a.roll.localeCompare(b.roll)).forEach(s => (groups[s.dept] = groups[s.dept] || []).push(s));
  const keys = Object.keys(groups).sort(), queue = [];
  while (keys.some(k => groups[k].length)) keys.forEach(k => { if (groups[k].length) queue.push(groups[k].shift()); });
  const out = [];
  let ri = 0, seat = 1;
  for (const s of queue) {
    while (seat > rooms[ri].row_count * rooms[ri].col_count) { ri++; seat = 1; }
    out.push({ student_id: s.id, room_id: rooms[ri].id, seat_no: seat++ });
  }
  return out;
}
module.exports = { plan };
