/* ---------- Firebase SDK (v12) ---------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile, signOut,
  GoogleAuthProvider, signInWithPopup, setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc,
  collection, addDoc, serverTimestamp, query, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---------- Config (Firebase project) ---------- */
const firebaseConfig = {
   apiKey: "AIzaSyBWTOgHmlJmCtpb2LQ7g3wj_IMsTwyTNDE",
  authDomain: "quizzy-ea14d.firebaseapp.com",
  projectId: "quizzy-ea14d",
  storageBucket: "quizzy-ea14d.firebasestorage.app",
  messagingSenderId: "452576898646",
  appId: "1:452576898646:web:9fa8dbc2e106bcce8615f7"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

/* ---------- Persistence ---------- */
try {
  await setPersistence(auth, browserLocalPersistence);
  console.log("[Auth] Persistence set to browserLocalPersistence");
} catch (e) {
  console.warn("[Auth] Could not set persistence:", e);
}

/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);
function show(id){
  document.querySelectorAll('section').forEach(s=>{
    s.classList.remove('active');
    s.style.display = 'none';
    s.style.opacity = '0';
  });
  const target = $(id);
  target.style.display = 'flex';
  requestAnimationFrame(()=>{ target.style.opacity = '1'; target.classList.add('active'); });

  // 🛑 stop timer if leaving quiz
  if(id !== "quiz"){
    stopTimer();
  }
  
  if(id === "quiz" && auth.currentUser){
    fetchLastFive();
  }
}
function msg(text){ $("auth-msg").textContent = text || ""; }

/* ---------- Timestamp helper ---------- */
function tsToDate(ts){
  if(!ts) return "";
  if (typeof ts.toDate === "function") return ts.toDate().toLocaleString();
  if (typeof ts.seconds === "number") return new Date(ts.seconds * 1000).toLocaleString();
  try { return new Date(ts).toLocaleString(); } catch { return ""; }
}

/* ---------- Paths ---------- */
const RAW_BASE = "https://singla1209.github.io/Quizzy/MCQ_CBSE/";
/* ---------- Subjects ---------- */
const SUBJECTS = [
  { key:"class6",  label:"Science March 2025", path:"March 2025/" },
  { key:"class7",  label:"Science September 2025", path:"September 2025/" },
  { key:"class8",  label:"SCIENCE March 2024", path:"March 2024/" },
  { key:"class9",  label:"SCIENCE September 2024", path:"4/" },
  { key:"class10", label:"SCIENCE March 2023", path:"5/" },
  
];

/* ---------- Utility ---------- */
function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  return arr;
}

/* ---------- State ---------- */
let userName = "";
let userId   = null;
let subject  = null;
let currentChapterTitle = "";
let questions = [];
let idx = 0, correct = 0, incorrect = 0, responses = [];
let quizStartMs = null;

// ✅ NEW LIFELINE CODE: Lifeline state
let lifelinesUsed = {
    fiftyFifty: false,
    geminiHint: false
};
// ✅ END NEW LIFELINE CODE

/* ---------- Timer state ---------- */
let timerId = null;

/* Build subject buttons */
const list = $("subject-list");
SUBJECTS.forEach(s => {
  const btn = document.createElement("button");
  btn.className = "btn subject";
  btn.textContent = s.label;
  btn.onclick = () => startSubject(s);
  list.appendChild(btn);
});

/* ---------- Auth actions ---------- */
$("login-btn").onclick = async () => {
  msg();
  let id = $("login-id").value.trim();
  const pass = $("login-pass").value;
  if(!id || !pass){ msg("Enter email/mobile and password."); return; }
  if(!id.includes("@")) id += "@mobile.com";
  try {
    await signInWithEmailAndPassword(auth, id, pass);
    msg("");
  } catch(e){ msg(humanAuthError(e)); }
};

$("google-btn").onclick = async () => {
  msg();
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    await setDoc(doc(db, "users", cred.user.uid), {
      name: cred.user.displayName || "",
      emailOrMobile: cred.user.email || "",
      createdAt: serverTimestamp()
    }, { merge:true });
  } catch(e){ msg(humanAuthError(e)); }
};

$("signup-btn").onclick = async () => {
  msg();
  const name = $("signup-name").value.trim();
  let id = $("signup-id").value.trim();
  const pass = $("signup-pass").value;
  if(!name || !id || !pass){ msg("Fill all sign up fields."); return; }
  if(!id.includes("@")) id += "@mobile.com";
  try {
    if(auth.currentUser){ await signOut(auth); }
    const cred = await createUserWithEmailAndPassword(auth, id, pass);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), {
      name, emailOrMobile: id, createdAt: serverTimestamp()
    }, { merge:true });
  } catch(e){ msg(humanAuthError(e)); }
};

$("logout-1").onclick = () => signOut(auth);
$("logout-2").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if(user){
    userId = user.uid;
    userName = user.displayName || user.email || "User";
    $("hello").textContent = `Hi ${userName}!`;
    show("subjects");
    fetchLastFive();
  } else {
    userId = null;
    show("auth");
  }
});

/* ---------- Quiz + Chapters ---------- */
async function startSubject(s){
  if(!auth.currentUser){ show("auth"); return; }
  subject = s;

  $("chapters-title").textContent = `Choose a chapter – ${s.label}`;
  $("chapters-subtitle").textContent = `CyberQuiz Session - Select Chapter`;
  const container = $("chapter-list");
  container.innerHTML = `<div class="muted" style="grid-column:1/-1">Loading chapters…</div>`;

  try{
    const url = RAW_BASE + s.path + "manifest.json";
    const res = await fetch(url, { cache:"no-store" });
    let files = [];
    if(res.ok){
      files = await res.json();
    } else {
      for(let i=1;i<=100;i++){
        const tryUrl = RAW_BASE + s.path + i + ".json";
        const head = await fetch(tryUrl, { method:"HEAD" });
        if(head.ok) files.push(i + ".json");
      }
    }

    if(!files.length){
      container.innerHTML = `<div class="muted">No chapter files found.</div>`;
    } else {
      container.innerHTML = "";
      files.forEach(name=>{
        const pretty = name.replace(/\.json$/,"");
        const btn = document.createElement("button");
        btn.className = "btn chapter";
        btn.textContent = pretty;
        btn.onclick = () => startChapterQuiz(s, name, pretty);
        container.appendChild(btn);
      });
    }
  } catch(err){
    container.innerHTML = `<div class="muted">Couldn't load chapters.</div>`;
  }
  show("chapters");
}

async function startChapterQuiz(s, fileName, prettyTitle){
  const url = RAW_BASE + s.path + fileName;
  currentChapterTitle = prettyTitle;
  await beginQuizFromUrl(url, s.label, prettyTitle);
}

async function beginQuizFromUrl(url, subjectLabel, chapterTitle){
  idx = 0; correct = 0; incorrect = 0; responses = [];
  quizStartMs = null;
  $("stats").textContent = `✅ Correct: 0  |  ❌ Incorrect: 0`;
  $("qprogress").textContent = `Question 1/1`;
  $("bar-inner").style.width = "0%";

   $("welcome-banner").innerHTML =
    `Welcome <span class="name">${userName}</span> in Quizzy App of <b>‘${subjectLabel}’ : ${chapterTitle.replace(/^Chapter\s*\d+\s*:\s*/i,'')}</b>`;

  // ✅ NEW LIFELINE CODE: Reset lifelines
  lifelinesUsed = { fiftyFifty: false, geminiHint: false };
  updateLifelineButtons();
  // ✅ END NEW LIFELINE CODE

  show("quiz");

  try{
    const res = await fetch(url, {cache:"no-store"});
    questions = await res.json();
  } catch(e){
    console.error("Fetch questions error", e);
    questions = [];
  }

  if(!questions.length){
    $("question").textContent = "Could not load questions.";
    $("options").innerHTML = "";
    return;
  }

  shuffle(questions);
  questions = questions.map(q => {
    const entries = Object.entries(q.options || {}).map(([key,text]) => ({key, text}));
    shuffle(entries);
    return { 
      ...q, 
      _optionsArr: entries, 
      _correctKey: q.correct,
      _explanation: q.explanation || ""   // ✅ keep explanation
    };
  });

  renderQuestion();
}

// ✅ NEW LIFELINE CODE: Function to check and update button states
function updateLifelineButtons() {
    $("fifty-fifty-btn").disabled = lifelinesUsed.fiftyFifty;
    $("gemini-hint-btn").disabled = lifelinesUsed.geminiHint;
}
// ✅ END NEW LIFELINE CODE

function renderQuestion(){
  const q = questions[idx];
  $("question").textContent = `Q${idx+1}. ${q.question}`;
  const optionsDiv = $("options");
  optionsDiv.innerHTML = "";

  q._optionsArr.forEach(opt=>{
    const div = document.createElement("div");
    div.className = "option";
    div.textContent = opt.text;
    div.dataset.key = opt.key; // ✅ Store key as data attribute
    div.onclick = () => choose(opt.key, div);
    optionsDiv.appendChild(div);
  });

  $("qprogress").textContent = `Question ${idx+1}/${questions.length}`;
  $("bar-inner").style.width = `${((idx)/questions.length)*100}%`;
  if(quizStartMs === null) quizStartMs = Date.now();
  
  // ✅ NEW LIFELINE CODE: Re-enable options pointer events
  document.querySelectorAll(".option").forEach(o => o.style.pointerEvents = "auto"); 
  
  // 🔹 Start timer for this question (30 sec)
  startTimer(30);
}

/* ---------- Shared answer handler ---------- */
function recordAnswer(q, selectedKey, isTimeout = false) {
  const correctKey = q._correctKey;
  const correctObj = q._optionsArr.find(x => x.key === correctKey);
  const correctAnswer = correctObj ? correctObj.text : "";

  let selectedAnswer = "No Answer";
  if (isTimeout) {
    selectedAnswer = "No Answer (timeout)";
    incorrect++;
    document.getElementById("wrong-sound").play();
  } else {
    const selectedObj = q._optionsArr.find(x => x.key === selectedKey);
    selectedAnswer = selectedObj ? selectedObj.text : "No Answer";

    if (selectedKey === correctKey) {
      correct++;
      document.getElementById("correct-sound").play();
    } else {
      incorrect++;
      document.getElementById("wrong-sound").play();
    }
  }

  responses.push({ 
    question: q.question, 
    selected: selectedAnswer, 
    correct: correctAnswer,
    explanation: q._explanation || ""    // ✅ save explanation
  });

  document.querySelectorAll(".option").forEach(o => {
    // Determine if the option's key matches the correct key
    const optionKey = o.dataset.key; // ✅ Use data attribute
    const isCorrect = optionKey === correctKey;
    if (isCorrect) o.classList.add("correct");
  });

  $("stats").textContent = `✅ Correct: ${correct}  |  ❌ Incorrect: ${incorrect}`;
  $("bar-inner").style.width = `${((idx+1)/questions.length)*100}%`;
}

function choose(selectedKey, el) {
  stopTimer(); // Stop timer when answer is chosen
  document.querySelectorAll(".option").forEach(o => o.style.pointerEvents = "none");
  const q = questions[idx];

  if (selectedKey !== q._correctKey) el.classList.add("wrong");

  recordAnswer(q, selectedKey, false);

  setTimeout(() => {
    if (idx < questions.length - 1) {
      idx++;
      renderQuestion();
    } else {
      finishQuiz();
    }
  }, 800);
}

function handleTimeUp() {
  const q = questions[idx];
  recordAnswer(q, null, true);

  setTimeout(() => {
    if (idx < questions.length - 1) {
      idx++;
      renderQuestion();
    } else {
      finishQuiz();
    }
  }, 800);
}

// ✅ NEW LIFELINE CODE: 50:50 Logic
$("fifty-fifty-btn").onclick = () => {
    if (lifelinesUsed.fiftyFifty) return;
    
    const q = questions[idx];
    const optionsDivs = Array.from(document.querySelectorAll("#options .option"));
    const correctKey = q._correctKey;
    
    // Find incorrect options
    const incorrectOptions = optionsDivs.filter(o => o.dataset.key !== correctKey);
    
    // Select one incorrect option to keep
    const keptIncorrect = incorrectOptions[Math.floor(Math.random() * incorrectOptions.length)];
    
    // Find the two options to remove (the rest of the incorrect ones)
    const removedOptions = incorrectOptions.filter(o => o !== keptIncorrect);
    
    // Remove (visually hide) the options
    removedOptions.forEach(o => {
        o.style.opacity = '0.3'; // Optional: Just dim them
        o.style.pointerEvents = 'none';
        o.onclick = null; // Disable click event
        o.textContent += " (Eliminated)"; // Indicate they're gone
    });

    lifelinesUsed.fiftyFifty = true;
    updateLifelineButtons();
};
// ✅ END NEW LIFELINE CODE


// ✅ NEW LIFELINE CODE: Gemini Hint Logic (using explanation from JSON)
document.getElementById("gemini-hint-btn").onclick = () => {
    if (lifelinesUsed.geminiHint) return;

    const q = questions[idx];  // current question
    let hint = q.explanation || "No explanation available for this question.";

    // Show the modal with explanation
    const overlay = document.getElementById("modal-overlay");
    overlay.innerHTML = `
      <div class="modal">
        <button class="close" id="modal-close" aria-label="Close">✕</button>
        <div id="modal-content">
          <h2>🧠 Hint</h2>
          <p style="text-align:left; line-height:1.6; font-size:1.1rem">${hint}</p>
          <p class="muted" style="margin-top:15px;">(Close this to continue the quiz)</p>
        </div>
      </div>
    `;
    overlay.style.display = "flex";  // make it visible

    document.getElementById("modal-close").onclick = () => {
        overlay.style.display = "none";
    };

    lifelinesUsed.geminiHint = true;
    updateLifelineButtons();
};
// ✅ END NEW LIFELINE CODE


/* ---------- Timer (Circular, wrong on timeout) ---------- */
const radius = 50;
const circumference = 2 * Math.PI * radius;

function startTimer(totalTime) {
  clearInterval(timerId);
  let timeLeft = totalTime;

  const display = document.getElementById("time-left");
  const progressCircle = document.querySelector(".progress");
  const tickSound = document.getElementById("tick-sound");

  if (!display || !progressCircle) return;

  display.textContent = timeLeft;
  progressCircle.style.strokeDasharray = circumference;
  progressCircle.style.strokeDashoffset = 0;
  progressCircle.style.stroke = "#22c55e";

  timerId = setInterval(() => {
    timeLeft--;

    if (tickSound) {
      tickSound.currentTime = 0;
      tickSound.play().catch(() => {});
    }

    display.textContent = timeLeft;
    const offset = circumference - (timeLeft / totalTime) * circumference;
    progressCircle.style.strokeDashoffset = offset;

    if (timeLeft > totalTime * 2/3) {
      progressCircle.style.stroke = "#22c55e"; 
    } else if (timeLeft > totalTime / 3) {
      progressCircle.style.stroke = "#eab308"; 
    } else {
      progressCircle.style.stroke = "#ef4444"; 
    }

    if (timeLeft <= 0) {
      clearInterval(timerId);
      handleTimeUp();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerId);
  timerId = null;

  const tickSound = document.getElementById("tick-sound");
  if (tickSound) {
    tickSound.pause();
    tickSound.currentTime = 0;
  }
}

/* ---------- Finish quiz ---------- */
async function finishQuiz(){
  clearInterval(timerId);
  $("question").textContent = "All done!";
  $("options").innerHTML = "";
  $("end-screen").style.display = "block";
  $("end-screen").innerHTML = `<h3>Score: ${correct} / ${questions.length}</h3>`;

  const timeTakenSec = quizStartMs ? Math.round((Date.now() - quizStartMs)/1000) : 0;

  try{
    const current = auth.currentUser;
    if (current) {
      await addDoc(collection(db, "quiz_results"), {
        uid: current.uid,
        userName: current.displayName || current.email || "User",
        subject,
        chapter: currentChapterTitle,
        correctAnswers: correct,
        incorrectAnswers: incorrect,
        responses,
        timeTaken: timeTakenSec,
        date: new Date()
      });
    }
      fetchLastFive(); // ✅ refresh last 5 results panel
  } catch(e){ 
    console.error("Save failed:", e); 
  }

  $("big-name").textContent = userName || "Great Job!";
  $("motivation").textContent = `You scored ${correct} out of ${questions.length}!`;
  $("celebrate-overlay").style.display = "flex";
  $("celebrate-overlay").removeAttribute("aria-hidden");

  
  // 🔹 Celebration
  const pct = questions.length ? (correct / questions.length) * 100 : 0;
  launchCelebration(Math.round(pct));
}

/* ---------- Last 5 Results ---------- */
async function fetchLastFive(userId){
  try {
    const uid = userId || (auth.currentUser && auth.currentUser.uid);
    if (!uid) return;

    const qref = query(
      collection(db, "quiz_results"),
      orderBy("date", "desc"),
      limit(5)
    );
    const snapshot = await getDocs(qref);

    const tbody = document.getElementById("last5-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    snapshot.forEach(docSnap => {
      const d = docSnap.data();
      if (d.uid !== uid) return;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${tsToDate(d.date)}</td>
        <td>${d.subject || "-"}</td>
        <td>${d.userName || "-"}</td>
        <td>${d.correctAnswers ?? 0}</td>
        <td>${d.incorrectAnswers ?? 0}</td>
        <td>${d.timeTaken ? d.timeTaken + " sec" : "-"}</td>
      `;
      tr.style.cursor = "pointer";
      tr.onclick = () => showResultDetails(d);
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error("Error fetching last 5 results:", e);
  }
}

function showResultDetails(result){
  const overlay = document.getElementById("modal-overlay");
  if (!overlay) return;
  overlay.innerHTML = `
    <div class="modal">
      <h2>Quiz Details</h2>
      <p><b>User:</b> ${result.userName || result.name || "-"}</p>
      <p><b>Date:</b> ${tsToDate(result.date)}</p>
      <p><b>Subject:</b> ${result.subject || "-"}</p>
      <p><b>Chapter:</b> ${result.chapter || "-"}</p>
      <p><b>Correct:</b> ${result.correctAnswers ?? 0}</p>
      <p><b>Incorrect:</b> ${result.incorrectAnswers ?? 0}</p>
      <p><b>Time Taken:</b> ${result.timeTaken ? result.timeTaken + " sec" : "-"}</p>
      <h3>Responses:</h3>
      <ul>
        ${(Array.isArray(result.responses) ? result.responses : []).map(r => `
          <li style="margin-bottom:12px;">
            <b>Q:</b> ${r.question}<br>
            <b>Your Answer:</b> ${r.selected}<br>
            <b>Correct Answer:</b> ${r.correct}<br>
            ${r.explanation ? `<b>Explanation:</b> ${r.explanation}` : ""}
          </li>
        `).join("")}
      </ul>
      <button onclick="document.getElementById('modal-overlay').style.display='none'">Close</button>
    </div>
  `;
  overlay.style.display = "block";
}

/* ---------- Errors ---------- */
function humanAuthError(e){
  const code = (e && e.code) ? e.code : "";
  switch(code){
    case "auth/invalid-email": return "Please enter a valid email.";
    case "auth/wrong-password":
    case "auth/user-not-found": return "Invalid email or password.";
    case "auth/email-already-in-use": return "This email is already registered.";
    default: return e?.message || "Authentication error.";
  }
}

/* ---------- Nav ---------- */
$("back-to-subjects").onclick = () => show("chapters");
$("back-to-subjects-2").onclick = () => show("subjects");

/* ---------- Play Again ---------- */
$("play-again-btn").onclick = () => {
  if(subject && currentChapterTitle){
    const fileName = currentChapterTitle + ".json";
    startChapterQuiz(subject, fileName, currentChapterTitle);
  }
  $("back-to-subjects-2").focus(); // ✅ move focus out of hidden element
};

/* =======================================================
   Celebration: confetti (canvas), donut, random messages
   ======================================================= */
const confettiCanvas = $("confetti");
const ctxC = confettiCanvas.getContext("2d");
let confettiParticles = [];
let ribbons = [];
let confettiAnimating = false;

const messagesLow = [
  "Every step counts — keep going!",
  "Good try! Let’s push a little more next time!",
  "You’re learning fast — don’t stop!",
  "Progress over perfection!",
  "Nice effort — keep at it!"
];
const messagesMid = [
  "Nice work — you’re getting there!",
  "Solid score! Keep the momentum.",
  "You’re on the right track!",
  "Nice rhythm — consistency wins.",
  "Great effort — aim higher next time!"
];
const messagesHigh = [
  "Outstanding! You’re a star!",
  "Brilliant performance — keep shining!",
  "Fantastic! You nailed it!",
  "Superb — excellence achieved!",
  "Incredible work — way to go!"
];

function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function sizeCanvas(){
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
sizeCanvas();
window.addEventListener("resize", sizeCanvas);

function spawnConfetti(count, speedMin, speedMax){
  for(let i=0;i<count;i++){
    confettiParticles.push({
      x: Math.random()*confettiCanvas.width,
      y: -20 - Math.random()*confettiCanvas.height*0.5,
      w: 6 + Math.random()*6,
      h: 10 + Math.random()*10,
      tilt: Math.random()*2*Math.PI,
      tiltSpeed: 0.02 + Math.random()*0.08,
      vy: speedMin + Math.random()*(speedMax-speedMin),
      vx: (Math.random()-0.5)*2,
      color: `hsl(${Math.floor(Math.random()*360)}, 90%, 60%)`
    });
  }
}
function spawnRibbons(count){
  for(let i=0;i<count;i++){
    ribbons.push({
      x: Math.random()*confettiCanvas.width,
      y: -50 - Math.random()*200,
      len: 80 + Math.random()*100,
      amp: 10 + Math.random()*20,
      phase: Math.random()*Math.PI*2,
      vy: 1.2 + Math.random()*2,
      color: `hsl(${Math.floor(Math.random()*360)}, 90%, 60%)`
    });
  }
}

function drawConfetti(){
  ctxC.clearRect(0,0,confettiCanvas.width, confettiCanvas.height);

  // rectangles
  confettiParticles.forEach(p=>{
    p.tilt += p.tiltSpeed;
    p.y += p.vy;
    p.x += p.vx + Math.sin(p.tilt)*0.3;
    ctxC.fillStyle = p.color;
    ctxC.save();
    ctxC.translate(p.x, p.y);
    ctxC.rotate(p.tilt);
    ctxC.fillRect(-p.w/2, -p.h/2, p.w, p.h);
    ctxC.restore();
  });
  confettiParticles = confettiParticles.filter(p => p.y < confettiCanvas.height + 40);

  // ribbons
  ribbons.forEach(r=>{
    r.y += r.vy;
    r.phase += 0.08;
    ctxC.strokeStyle = r.color;
    ctxC.lineWidth = 6;
    ctxC.beginPath();
    for(let t=0;t<r.len;t+=6){
      const xx = r.x + Math.sin(r.phase + t*0.08)*r.amp;
      const yy = r.y + t;
      if(t===0) ctxC.moveTo(xx,yy); else ctxC.lineTo(xx,yy);
    }
    ctxC.stroke();
  });
  ribbons = ribbons.filter(r => r.y < confettiCanvas.height + r.len);

  if(confettiParticles.length || ribbons.length){
    requestAnimationFrame(drawConfetti);
  }else{
    confettiAnimating = false;
  }
}

function startConfetti(level){
  sizeCanvas();
  if(level === "low"){
    spawnConfetti(120, 2, 3.5);
    spawnRibbons(6);
  }else if(level === "mid"){
    spawnConfetti(280, 2.5, 4.2);
    spawnRibbons(10);
  }else{
    spawnConfetti(480, 3, 5);
    spawnRibbons(16);
    for(let i=0;i<4;i++){
      setTimeout(()=>spawnConfetti(120, 3, 5), i*220);
    }
  }
  if(!confettiAnimating){
    confettiAnimating = true;
    drawConfetti();
  }
}

function renderDonut(score, total){
  const c = $("donut");
  const ctx = c.getContext("2d");
  ctx.clearRect(0,0,c.width,c.height);

  const pct = total ? score/total : 0;
  const cx = c.width/2, cy = c.height/2, r = 70, thickness = 22;

  // track
  ctx.lineWidth = thickness;
  ctx.strokeStyle = "rgba(255,255,255,.2)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.stroke();

  // value arc
  let color = "#ffb703";
  if(pct >= 0.8) color = "#00e6b0";
  else if(pct >= 0.5) color = "#5ab0ff";

  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + pct*2*Math.PI, false);
  ctx.stroke();

  // text
  ctx.fillStyle = "#fff";
  ctx.font = "bold 24px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${Math.round(pct*100)}%`, cx, cy-6);

  ctx.font = "12px Arial";
  ctx.fillStyle = "rgba(255,255,255,.8)";
  ctx.fillText(`${score}/${total}`, cx, cy+14);
}

function launchCelebration(pct){
  let level = "low";
  let m = pickRandom(messagesLow);
  if(pct >= 80){ level = "high"; m = pickRandom(messagesHigh); }
  else if(pct >= 50){ level = "mid"; m = pickRandom(messagesMid); }

  $("celebrate-overlay").style.display = "flex";
  $("big-name").textContent = `${userName || "Great Job!"}`;
  $("motivation").textContent = m;

  renderDonut(correct, questions.length);
  startConfetti(level);
}

$("celebrate-close").onclick = () => {
  $("celebrate-overlay").style.display = "none";
};
$("play-again-btn").onclick = () => {
  $("celebrate-overlay").style.display = "none";
  show("subjects");
};