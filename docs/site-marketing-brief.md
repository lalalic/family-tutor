# Family Tutor marketing brief

Status: authoritative strategy and copy direction for the family-tutor.qili2.com redesign.

This brief is for ordinary parents deciding whether Family Tutor could make family learning easier. It is not a technical product brief. The product truth in this document is taken from the current site and repository contracts; proposed language is marked as positioning or copy direction and must not be presented as measured proof.

## Strategic decision

Family Tutor should be understood as a calm layer of support around a child’s learning—not as another curriculum, chatbot, or parent surveillance tool.

The first question the site should answer is:

> “Will this help my child move forward while taking some of the explaining, chasing, and guessing off my plate?”

Recommended one-sentence value proposition:

> Family Tutor gives each child a patient, personal place to work things out—and gives parents a clear sense of what is helping, what needs practice, and when to step in.

Recommended positioning statement:

> For parents who want to support learning without becoming the nightly homework manager, Family Tutor is a personalized family learning companion that helps children get unstuck and grow more independent while giving parents concise, privacy-aware signals about progress and useful next steps.

## The strongest job to be done

### Who

Parents or guardians of school-age children who want to help with learning but cannot—or do not want to—be the child’s constant explainer, reminder system, and progress tracker. They may be comfortable using ChatGPT already, or may simply want a supported family setup rather than a new education platform to manage.

The primary buyer is the parent. The child is the person who must feel the benefit. The message should respect both: less pressure for the parent, more agency for the child.

### Why: the job

When my child is stuck, avoiding work, or losing confidence, help me support them without taking over. Give my child a place to ask questions and keep trying, and give me enough useful context to know whether to encourage, remind, or step in.

The emotional job is to replace nightly uncertainty and conflict with a sense that learning is moving somewhere. The practical job is to reduce repeated explanations, chasing, and manual coordination.

### What before

Parents commonly piece together a fragile routine from:

- answering questions themselves, even when they are tired or unsure;
- searching the web or watching videos that may be too advanced, too generic, or disconnected from the child’s actual work;
- reminding a child to start, continue, finish, and review;
- checking homework or asking “How did it go?” without a reliable, age-appropriate answer;
- using a general-purpose AI chat with no family setup, no child-specific continuity, and no clear parent boundary;
- buying tutoring or learning subscriptions that may add cost, scheduling, or a fixed curriculum.

The friction is not only “my child needs an answer.” It is “I cannot tell what kind of help is needed, and every attempt to help can turn into a disagreement.”

### How Family Tutor helps

The core product creates a separate, personalized tutor context for each child, keeps the child’s ordinary learning space separate from the parent space, and sends parents concise learning signals rather than routine transcripts. The hosted product provides guided setup, family-scoped connectivity, child-specific project bindings, logical routing, and an acceptance check; those are delivery mechanisms, not headline benefits.

The child-facing experience can support questions, explanations, attachments, and voice messages through the implemented runtime paths. The parent-facing experience can surface topics, evidence of understanding, misconceptions, progress, missed plans, next steps, reminders, and when support may help. The exact capabilities available to a family depend on the configured product path and agreed pilot scope.

### What after

The desired future state is:

- a child can ask, try, revise, and get unstuck without waiting for a parent to be available;
- the parent explains and chases less, because they are not the only source of help or follow-up;
- the child gradually owns more of the next step;
- the parent knows when encouragement is enough and when a real conversation or intervention is useful;
- homework support feels less like a nightly contest;
- the family can talk about learning from useful signals instead of a full message history.

These are intended outcomes, not guaranteed results or claims of measured impact.

### Alternatives

| Alternative | Why families use it | Friction Family Tutor should address |
| --- | --- | --- |
| Parent-led help | Trusted, immediate, no setup | Repeats the parent’s time burden and can make every question a negotiation |
| Search, videos, worksheets | Cheap and abundant | Generic material may not meet the child at the right level or connect to the current task |
| General-purpose AI chat | Fast answers and broad coverage | Usually not configured around the family’s child-specific context or parent visibility needs |
| Private tutor or tutoring centre | Human expertise and accountability | Scheduling, cost, availability, and the parent may still lack a concise view of day-to-day progress |
| Curriculum or learning subscription | Structured content and practice | Can be rigid, content-led, or another system for the family to manage |

Family Tutor’s reason to choose is the combination of child agency, parent relief, family-specific continuity, privacy-aware visibility, and assisted setup. It should not claim to replace a teacher, tutor, parent, or school curriculum.

## Pain and anxiety hierarchy

Use the pains in this order on the page. The first two belong above the fold; technical setup belongs near the bottom or in the FAQ.

1. **“I am becoming the homework manager.”** Repeated explaining, prompting, checking, and negotiating are exhausting.
2. **“I cannot tell what kind of help my child needs.”** A quiet child, a confident-sounding child, and an unfinished assignment can all hide different problems.
3. **“My help may be making this harder.”** Pressure, correction, and hovering can turn a small sticking point into a family conflict.
4. **“My child gives up too quickly.”** The child needs a safe place to ask imperfect questions and keep trying.
5. **“I do not want useful support to become surveillance.”** Parents need meaningful visibility without routine transcript monitoring.
6. **“I do not want another complicated system.”** Setup, accounts, permissions, and daily maintenance must feel supported rather than handed to the parent.

Copy should acknowledge the tension plainly: parents want to stay involved, but they do not want to hover; children need support, but they need room to think.

## Outcome hierarchy

### Primary promise

**Less homework friction. More confident next steps.**

### Secondary outcomes

- **Child gets unstuck:** a patient place to ask, understand, and try again.
- **Parent explains less:** support is available without making the parent the default tutor.
- **Child becomes more independent:** the goal is not endless answer delivery; it is helping the learner take the next step.
- **Parent knows when to step in:** concise signals show where encouragement is enough and where support may be useful.
- **Fewer homework conflicts:** separate child space and parent visibility reduce the feeling of being watched or chased.
- **A calmer family learning rhythm:** reminders and short updates make follow-up more intentional.

## Product truth and safe marketing language

| Product truth in the current implementation | Safe outcome-led language | Do not say |
| --- | --- | --- |
| Separate child context and private child destination; parent receives filtered learning telemetry | “Your child gets room to ask imperfect questions. You get useful signals, not a transcript.” | “Completely secret,” “parents can never see messages,” or “zero monitoring” |
| Parent reports can include topic, evidence, misconception, progress, missed plan, next step, and useful support | “Know what was studied, what clicked, what needs practice, and when your help may matter.” | “Real-time academic dashboard” or guaranteed progress |
| Runtime supports image and other attachments, local audio transcription, and child-facing output attachments in the local path | “Learning can start from a question, a photo, or a voice message,” when that path is enabled | Universal voice tutor, guaranteed multimodal support, or a claim that every deployment has identical capabilities |
| Hosted MCP currently exposes core messaging and an entitled `create_study_plan` premium tool | “Turn a topic into a focused plan and review path,” only for an approved premium scope | A large premium catalogue or automatic personalization that is not implemented |
| Project-local NotebookLM skill supports source-grounded study/research workflows | “School materials can become a more useful study companion,” only when the NotebookLM-backed workflow is included and verified | “Every upload is automatically understood,” or imply NotebookLM is part of every base family setup |
| Assisted onboarding verifies family connections, child bindings, extension readiness, and acceptance | “We help you get the family setup working and check the child path before you begin.” | “Instant setup,” “works with any account,” or self-serve simplicity that the current flow does not provide |
| Pilot site currently uses a `mailto:hello@qili2.com` enquiry path and says scope/pricing are confirmed before participation | “Tell us what you want to make easier; we’ll reply with the next sensible step.” | Invented testimonials, customer counts, ratings, guarantees, or final pricing |

Implementation words—ChatGPT Projects, Discord, MCP, extension, routing, bindings, and telemetry—may appear in an FAQ or setup detail, but never as the hero promise or first value cards.

## Premium value framing

Premium should be sold as additional family outcomes, not as a list of internal tool names. Use a label such as **More ways to make learning fit your child** rather than “Premium tools.”

Recommended premium outcome cards:

1. **Learn by speaking, seeing, or typing** — voice and image-based inputs can make it easier for a child to show where they are stuck.
2. **Turn school material into useful help** — when the source-grounded study workflow is included, supplied school materials can support explanations, synthesis, and practice instead of sitting untouched in a folder.
3. **Make review easier to return to** — a focused study plan can turn a topic into manageable next steps and review moments.
4. **Keep the parent rhythm light** — smart reminders and concise parent reports support follow-through without turning the parent into a project manager.

The designer should show premium as an optional, clearly scoped layer. Since the repository currently marks some of these capabilities as entitled or project-local rather than universal, the live page should say “available with the right setup / pilot scope” until the owner approves exact packaging.

## Recommended page information architecture

1. **Hero: relief and child outcome**
   - Lead with less homework friction and more confident next steps.
   - Primary CTA: `Tell us what you want to make easier`.
   - Secondary CTA: `See how it works`.
   - One trust line: “A private learning space for each child, with useful signals for parents.”

2. **The parent tension: involved, not hovering**
   - Three short situations: stuck homework, repeated reminders, not knowing whether to step in.
   - Close with: “You should not have to choose between taking over and standing back.”

3. **The five outcome cards**
   - Child gets unstuck.
   - You explain and chase less.
   - Your child takes more of the next step.
   - You know when to step in.
   - Fewer homework conflicts.

4. **How the family rhythm works**
   - Child asks and tries.
   - The tutor helps them work through it.
   - The parent receives a short, useful signal.
   - The family chooses the next support step.

5. **Parent visibility without transcript monitoring**
   - Explain private child space, concise learning signals, and minimum-necessary safety escalation.
   - Link to the privacy page.

6. **Optional ways to go further**
   - Voice/audio learning, school-material support, source-grounded study help, planning/review, reminders/reports.
   - Label pilot or premium availability honestly.

7. **A simple assisted-start section**
   - “Tell us about your family.”
   - “We agree the right setup and scope.”
   - “We connect the family spaces and check the path.”
   - “Your child starts with a place to ask.”

8. **FAQ and privacy**
   - Is this a curriculum subscription?
   - Can parents read every message?
   - What does setup involve?
   - What happens if my child needs more help than AI can give?
   - What is included in the pilot or premium layer?
   - Who owns the family’s accounts and learning data?

9. **Final CTA**
   - Repeat the relief/outcome promise.
   - Use the same low-pressure enquiry CTA; do not manufacture urgency or scarcity.

## Hero options

### Recommended

**Less homework friction. More confident next steps.**

Family Tutor gives your child a patient place to work things out—and gives you a clear sense of what is helping, what needs practice, and when to step in.

CTA: **Tell us what you want to make easier**

### Option B: parent relief first

**Support your child without becoming the homework manager.**

A personal learning companion for your child, with concise updates that help you stay involved without hovering.

CTA: **See how family learning can feel calmer**

### Option C: child agency first

**A place for your child to ask, try, and get unstuck.**

Family Tutor helps children work through questions while keeping parents close to the learning signals that matter.

CTA: **Explore the family learning loop**

Use the recommended option unless testing shows that parent-relief language produces a clearer response. Avoid leading with “AI,” “ChatGPT,” or product infrastructure.

## Key value-card copy

### Child gets unstuck

When the first explanation does not click, your child has somewhere patient to ask again, try another angle, and keep moving.

### You explain and chase less

The tutor can handle more of the everyday “I don’t get it” moments, so you are not the only person who has to start the work or explain the next step.

### Your child takes more of the next step

The aim is support that builds confidence and independence—not a faster way to hand over answers.

### You know when to step in

Short learning signals can show what your child studied, what clicked, what needs practice, and where your support may help.

### Fewer homework conflicts

Give your child room to think while keeping the family conversation focused on useful support, not constant checking.

## Reminders and status-report messaging

Use these phrases consistently:

- “A short update, not a transcript.”
- “Know what was studied, what clicked, and what needs practice.”
- “Reminders tied to a real next step—not noise for the sake of a notification.”
- “See when encouragement is enough and when your help may be useful.”
- “Stay close to learning without watching every message.”

Do not promise that every reminder is automatic, perfectly timed, or always correct. The product contract says proactive support should be justified by learner state, review need, an open loop, or a commitment; marketing should preserve that intent.

## Objection handling

**“Is this just another AI chatbot?”**
No. The value is the family rhythm: a separate learning space for each child, continuity around what matters, and concise parent visibility. The site can mention the underlying AI only after explaining the outcome.

**“Will I have to watch another app?”**
The intended parent experience is a short learning signal, not a stream of messages. Setup is assisted, and the exact channels and support window are agreed before participation.

**“Can I read everything my child says?”**
Parents do not normally have access to the child’s tutor channel and are not routinely watching individual messages. Family Tutor may share appropriate learning signals; serious safety concerns are handled with minimum-necessary escalation.

**“Will this replace me, a teacher, or a tutor?”**
No. It is a support layer. It can help with everyday questions and learning follow-up, while adults and educators remain important for judgment, care, and situations needing human help.

**“What if my child needs a real person?”**
The product should make it easier to notice when parent or educator support may help. Do not market Family Tutor as a substitute for professional, school, or safeguarding support.

**“How much does it cost?”**
The current site describes a founding-family pilot with scope and pricing confirmed before participation. Keep the CTA an enquiry until the owner approves a final offer; do not turn the existing pilot hypothesis into a public promise.

**“Will setup be complicated?”**
The intended path is guided setup and an acceptance check. Keep technical names in the setup details, not the hero. Never promise zero setup or universal compatibility.

## CTA strategy

Use one primary action throughout the page so the visitor does not have to decide between sales, demo, signup, and pilot flows that do not yet exist.

Primary CTA: **Tell us what you want to make easier**
Destination: the approved founding-family enquiry path (`mailto:hello@qili2.com` in the current site).

Secondary CTA: **See how it works**
Destination: the family-learning-loop / how-it-works section.

Privacy CTA: **Read the privacy and consent notes**
Destination: `/privacy-consent.html`.

The enquiry prompt should ask only for a first name, children’s age ranges, and what the parent hopes to make easier. Keep the existing instruction not to include private child conversations. Do not add a child-content form, tracking pixels, invented scarcity, or pressure language.

## Final copy skeleton for implementation

```text
Eyebrow: A calmer way to support family learning
H1: Less homework friction. More confident next steps.
Body: Family Tutor gives your child a patient place to work things out—and gives you a clear sense of what is helping, what needs practice, and when to step in.
Primary CTA: Tell us what you want to make easier
Secondary CTA: See how it works

Section: You should not have to choose between taking over and standing back.
Body: When homework stalls, reminders become arguments, and “How did it go?” tells you almost nothing, Family Tutor gives the family a more useful middle path.

Cards:
Child gets unstuck.
You explain and chase less.
Your child takes more of the next step.
You know when to step in.
Fewer homework conflicts.

Section: A simple learning rhythm for your family
Steps: Child asks and tries → Tutor helps them work through it → Parent gets a short signal → Family chooses the next step.

Section: Private enough for honest questions. Visible enough for care.
Body: Each child has a separate tutor space. Parents receive useful learning signals—not routine transcripts.
Link: Read the privacy and consent notes

Section: More ways to make learning fit your child
Cards: Voice and image-based learning; school-material study help; source-grounded synthesis when included; focused planning and review; smart reminders and parent reports.
Label: Availability depends on the agreed family setup and pilot/premium scope.

Section: Start with one thing you want to make easier.
Body: Tell us a little about your family. We’ll reply with the next sensible step.
CTA: Tell us what you want to make easier

FAQ: Is this a curriculum subscription? Can parents read every message? What does setup involve? What is included? Who owns the family’s accounts and learning data?
Footer CTA: Support your child without becoming the homework manager.
```

## Guardrails for design and review

- Keep the first viewport human, warm, and outcome-led; technology can be a supporting detail.
- Do not add testimonials, usage numbers, ratings, guarantees, “proven” language, or research claims without approved evidence.
- Do not claim absolute secrecy, zero data, replacement of parents/teachers, or universal availability.
- Preserve the current privacy contract: child spaces are private by default, parent output is concise telemetry, and serious safety concerns are the minimum-necessary exception.
- Preserve the current commercial boundary: Family Tutor is setup, connectivity, routing, support, and explicitly entitled premium tooling around the family’s own ChatGPT account; it is not a curriculum marketplace or education-content SaaS.
- Keep the pilot and pricing status explicit until owner/counsel and business approvals are complete.
- Validate the final page against `npm run check`, `git diff --check`, keyboard navigation, mobile width, reduced motion, privacy links, and the real enquiry CTA.
