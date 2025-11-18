/*
  script.js

  This file implements the Course Explorer application logic.

  Responsibilities:
  - Define a Course class with factory/validation/formatting helpers
  - Load JSON course data from a user-selected file (FileReader) or
    via fetch for an example file when served over HTTP
  - Generate filter dropdowns from the loaded data (no hard-coded lists)
  - Apply multiple filters using Array.prototype.filter()
  - Sort the filtered results by title, id, or semester (normalized)
  - Render the course list and an accessible details panel
  - Provide robust error handling and informative UI messages

  Contract / data shapes:
  - Input: JSON containing an array of course objects, or an object
    with a `courses` or `items` array. Each course may include fields
    such as: id, title, posted/semester, type, level, credits, instructor, detail.
  - Output: DOM updates in `#courseList` and `#courseDetails`.

  Error modes: parse errors, missing array root, invalid course entries.
  The loader reports these in the UI (`#fileError` and `#fileInfo`) and
  skips invalid items (doesn't crash the page).
*/

// Course class per spec
// Encapsulates course data and provides small helper methods used by the UI
class Course {
  /**
   * @param {Object} data raw course object
   */
  constructor(data){
    // Safe defaults for missing fields
    this.id = data.id ?? '';
    this.title = data.title ?? data.name ?? 'Untitled';
    this.posted = data.posted ?? data.semester ?? data.postedTime ?? '';
    this.type = data.type ?? data.courseType ?? '';
    this.level = data.level ?? data.courseLevel ?? '';
    this.skill = data.skill ?? data.skills ?? '';
    this.credits = data.credits ?? data.credit ?? '';
    this.instructor = data.instructor ?? data.teacher ?? '';
    this.detail = data.detail ?? data.description ?? '';
  }

  /**
   * Create a Course from a raw object (factory)
   * @param {Object} obj
   * @returns {Course}
   */
  static from(obj){
    return new Course(obj || {});
  }

  /**
   * Validate presence of a few key fields. Returns an array of missing
   * field names (empty if OK).
   * @returns {string[]}
   */
  validate(){
    const missing = [];
    if (!this.id) missing.push('id');
    if (!this.title) missing.push('title');
    if (!this.posted) missing.push('posted');
    return missing;
  }

  /**
   * Short one-line summary for lists
   * @returns {string}
   */
  getSummary(){
    return `${this.id}${this.id && this.title ? ' — ' : ''}${this.title}`;
  }

  /**
   * Return HTML for detailed view (escaped)
   * @returns {string}
   */
  toDetailHTML(){
    return `\n      <h4>${escapeHtml(this.title)}</h4>\n      <div class="muted">${escapeHtml(this.id)} • ${escapeHtml(this.posted)}</div>\n      <p>${escapeHtml(this.detail)}</p>\n      <dl>\n        <dt>Credits</dt><dd>${escapeHtml(String(this.credits))}</dd>\n        <dt>Level</dt><dd>${escapeHtml(this.level)}</dd>\n        <dt>Type</dt><dd>${escapeHtml(this.type)}</dd>\n        <dt>Instructor</dt><dd>${escapeHtml(this.instructor)}</dd>\n      </dl>\n    `;
  }

  // Backwards-compatible alias used elsewhere
  toHTML(){ return this.toDetailHTML(); }
}

// Utilities
// Small utility to escape any user-controlled text before inserting into HTML
// to avoid accidental HTML injection and ensure safe rendering.
function escapeHtml(s){
  if (!s) return '';
  return String(s).replace(/[&<>\"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;" })[c]);
}

function parseSemester(sem){
  // Expect formats like "Winter 2025"
  if (!sem) return {year:-Infinity,order:-Infinity,value:-Infinity};
  const parts = String(sem).trim().split(/\s+/);
  if (parts.length<2) return {year:-Infinity,order:-Infinity,value:-Infinity};
  const year = parseInt(parts[1],10) || 0;
  const season = parts[0].toLowerCase();
  // Academic ordering within a year: Winter -> Spring -> Summer -> Fall
  const map = { 'winter':1, 'spring':2, 'summer':3, 'fall':4 };
  const order = map[season] ?? 0;
  // value is a single number for easy comparison: year * 10 + order
  const value = year * 10 + order;
  return {year,order,value};
}

// DOM references: cached handles to elements we update frequently
const fileInput = document.getElementById('fileInput');
const fileError = document.getElementById('fileError');
const courseListEl = document.getElementById('courseList');
const courseDetailsEl = document.getElementById('courseDetails');
const countEl = document.getElementById('count');
const sortByEl = document.getElementById('sortBy');
const filterLevel = document.getElementById('filterLevel');
const filterCredits = document.getElementById('filterCredits');
const filterInstructor = document.getElementById('filterInstructor');
const filterType = document.getElementById('filterType');

// Application state
let allCourses = []; // array of Course instances (original valid data)
let filtered = [];   // the currently visible / filtered subset
let selectedEl = null; // DOM element of the selected course item (for highlighting)

// Helper: take parsed JSON (array or object) and turn into course list
/**
 * processRawData
 * Parse the parsed JSON structure (could be an array or object with courses/items)
 * Validate each item and separate valid / invalid entries.
 * - valid entries become Course instances and are loaded
 * - invalid entries are skipped and summarized in the UI so the user can fix them
 */
function processRawData(data){
  clearInfo();
  let arr = [];
  if (Array.isArray(data)) arr = data;
  else if (data && Array.isArray(data.courses)) arr = data.courses;
  else if (data && Array.isArray(data.items)) arr = data.items;
  else {
    showError('JSON does not contain an array of courses. Expected an array or { courses: [...] }.');
    return;
  }

  const valid = [];
  const invalid = [];

  // Validate every entry individually to avoid crashing the whole load on a
  // single malformed object. We collect a short description of missing fields
  // to help the user debug their file.
  arr.forEach((raw, idx) => {
    try{
      const c = Course.from(raw);
      const missing = c.validate();
      if (missing.length > 0){
        invalid.push({index: idx, missing, raw});
      } else {
        valid.push(c);
      }
    }catch(e){
      // protect against unexpected shapes
      invalid.push({index: idx, missing: ['parse error'], raw});
    }
  });

  // Replace the canonical data set with the validated items
  allCourses = valid;
  populateFilterOptions(allCourses);
  applyFiltersAndRender();

  // Show a concise summary of what was loaded and what was skipped
  if (invalid.length === 0){
    showInfo(`Loaded ${valid.length} course${valid.length===1?'':'s'}.`);
  } else {
    const summary = `Loaded ${valid.length} course${valid.length===1?'':'s'}, skipped ${invalid.length} invalid entr${invalid.length===1?'y':'ies'}.`;
    // list up to 8 skipped items with missing fields to help debugging
    const list = invalid.slice(0,8).map(i=>`#${i.index}: missing ${i.missing.join(', ')}`).join('\n');
    showInfo(summary + (invalid.length ? '\n' + list + (invalid.length>8 ? '\n...more' : '') : ''));
  }
}

fileInput.addEventListener('change', e=>{
  const file = e.target.files && e.target.files[0];
  if (!file){ showError('No file selected.'); return; }
  const reader = new FileReader();
  reader.onload = ev=>{
    try{
      const parsed = JSON.parse(ev.target.result);
      processRawData(parsed);
      hideError();
    }catch(err){
      showError('Failed to read JSON: ' + err.message);
      allCourses = [];
      filtered = [];
      renderList();
    }
  };
  reader.onerror = ()=> showError('Error reading file');
  reader.readAsText(file);
});

// Load the example courses.json via fetch (works when served over HTTP).
const loadExampleBtn = document.getElementById('loadExampleBtn');
loadExampleBtn.addEventListener('click', ()=>{
  fetch('courses.json')
    .then(r=>{ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(data=>{ processRawData(data); hideError(); })
    .catch(err=> showError('Could not load example courses. If you are opening the page via file:// the browser will block fetch; either serve the folder (e.g., `python -m http.server`) or use the file input.'));
});

// Filter change events
[filterLevel, filterCredits, filterInstructor, filterType, sortByEl].forEach(el=>{
  el.addEventListener('change', ()=>applyFiltersAndRender());
});

function showError(msg){ fileError.style.display='block'; fileError.textContent = msg; }
function hideError(){ fileError.style.display='none'; fileError.textContent = ''; }
function showInfo(msg){
  const el = document.getElementById('fileInfo');
  if (!el) return;
  el.style.display = 'block';
  // preserve line breaks
  el.textContent = msg;
}
function clearInfo(){
  const el = document.getElementById('fileInfo');
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
}

function populateFilterOptions(courses){
  // Use Sets to collect unique values
  const levels = new Set();
  const credits = new Set();
  const instructors = new Set();
  const types = new Set();
  courses.forEach(c=>{
    if (c.level) levels.add(c.level);
    if (c.credits !== undefined && c.credits !== null && c.credits!="") credits.add(String(c.credits));
    if (c.instructor) instructors.add(c.instructor);
    if (c.type) types.add(c.type);
  });

  fillSelect(filterLevel, levels);
  fillSelect(filterCredits, credits);
  fillSelect(filterInstructor, instructors);
  fillSelect(filterType, types);
}

function fillSelect(selectEl, valuesSet){
  // Keep first option (All)
  const keep = selectEl.querySelector('option');
  selectEl.innerHTML = '';
  selectEl.appendChild(keep.cloneNode(true));
  const values = Array.from(valuesSet).filter(v=>v!==undefined && v!==null && String(v)!=='').sort((a,b)=>String(a).localeCompare(String(b)));
  values.forEach(v=>{
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

function applyFiltersAndRender(){
  const levelVal = filterLevel.value;
  const creditsVal = filterCredits.value;
  const instrVal = filterInstructor.value;
  const typeVal = filterType.value;

  filtered = allCourses.filter(c=>{
    if (levelVal && String(c.level) !== levelVal) return false;
    if (creditsVal && String(c.credits) !== creditsVal) return false;
    if (instrVal && String(c.instructor) !== instrVal) return false;
    if (typeVal && String(c.type) !== typeVal) return false;
    return true;
  });

  sortFiltered();
  renderList();
}

function sortFiltered(){
  const val = sortByEl.value;
  const parts = val.split('-');
  const key = parts[0];
  const dir = parts[1] === 'desc' ? -1 : 1;

  filtered.sort((a,b)=>{
    // Title: case-insensitive, locale-aware
    if (key === 'title') return dir * String(a.title).localeCompare(String(b.title), undefined, {sensitivity:'base'});

    // ID: use localeCompare with numeric option so IDs like CPSC-2 and CPSC-10 sort intuitively
    if (key === 'id') return dir * String(a.id).localeCompare(String(b.id), undefined, {numeric:true, sensitivity:'base'});

    // Semester: use parseSemester().value (year*10 + seasonOrder) for direct comparison
    if (key === 'sem'){
      const pa = parseSemester(a.posted || a.semester || '');
      const pb = parseSemester(b.posted || b.semester || '');
      return dir * (pa.value - pb.value);
    }

    return 0;
  });
}

function renderList(){
  courseListEl.innerHTML = '';
  if (filtered.length === 0){
    courseListEl.innerHTML = '<div class="muted">No courses to show.</div>';
  } else {
    filtered.forEach((c, idx)=>{
      const item = document.createElement('div');
      item.className = 'course-item';
      item.tabIndex = 0;
      item.dataset.idx = String(idx);
      item.innerHTML = `<strong>${escapeHtml(c.title)}</strong><div class="muted">${escapeHtml(c.id)} • ${escapeHtml(c.posted)}</div>`;
      item.addEventListener('click', ()=> showDetails(c, item));
      item.addEventListener('keydown', e=>{ if (e.key === 'Enter') showDetails(c, item); });
      courseListEl.appendChild(item);
    });
  }
  countEl.textContent = `${filtered.length} course${filtered.length===1?'':'s'}`;
  // clear selection when the list changes
  if (selectedEl){
    selectedEl.classList.remove('selected');
    selectedEl = null;
    // reset details area to default if selection cleared
    if (filtered.length === 0) courseDetailsEl.innerHTML = '<div class="muted">Click a course to view details.</div>';
  }
}

function clearDetails(){
  if (selectedEl){
    selectedEl.classList.remove('selected');
    selectedEl = null;
  }
  courseDetailsEl.innerHTML = '<div class="muted">Click a course to view details.</div>';
}

function showDetails(course, itemEl){
  // highlight the selected item
  if (selectedEl && selectedEl !== itemEl) selectedEl.classList.remove('selected');
  selectedEl = itemEl || null;
  if (selectedEl) selectedEl.classList.add('selected');

  // render the detailed HTML and add a close button
  courseDetailsEl.innerHTML = course.toDetailHTML() + '<div style="margin-top:8px"><button id="closeDetailBtn" style="padding:6px;border-radius:6px;border:1px solid #ddd;background:#fff;cursor:pointer">Close</button></div>';
  const closeBtn = document.getElementById('closeDetailBtn');
  if (closeBtn) closeBtn.addEventListener('click', clearDetails);
  // move focus to the details panel for screen reader users
  courseDetailsEl.focus();
}

// Close details on Escape
document.addEventListener('keydown', e=>{
  if (e.key === 'Escape') clearDetails();
});

// Initial small sanity check: if the repo contains courses.json in same folder, we won't auto-load (browser security), but we'll hint to user.
(function hint(){
  // no-op for now. Could check if a server is used to load automatically.
})();

// Expose some globals for debugging in the console (optional)
window._courseExplorer = { allCourses, filtered, Course };
