// Things the companion can already do, shown on the Ideas page in this order.
// Copy is English source text; pass it through `t` where it is shown. An idea
// without `included` shows no "What's included" section.

export type IdeaIncluded = { name: string; detail: string };

export type CatalogIdea = {
  id: string;
  title: string;
  body: string;
  category: string;
  included?: IdeaIncluded[];
};

export type IdeaSection = {
  // The first section has no heading.
  title?: string;
  ideas: CatalogIdea[];
};

// Kinds of work an idea sets up, shown as the name of an included row.
const recurring = "Recurring task";
const widget = "Widget";

export const ideaCatalog: IdeaSection[] = [
  {
    ideas: [
      {
        id: "fare-drop",
        title:
          "Fares dropped? I’ll book your seats the moment the price fits your budget.",
        body: "Give me your route, dates and top price. I’ll check fares every day, and as soon as one qualifies I’ll book the seats and confirm the total against the rules you set.",
        category: "Travel",
        included: [
          {
            name: recurring,
            detail: "Checks every day whether the cost is over your cap.",
          },
        ],
      },
      {
        id: "occasion-planner",
        title:
          "Name the occasion and I’ll arrange everything and send the invites.",
        body: "Just tell me the occasion, how many guests and your budget, and I’ll handle the whole plan: the theme, the guest list, the invitation design (with RSVP tracking), sending the invites, following up on replies, and ordering every supply before the event, with local backups lined up in case anything is delayed.",
        category: "Local",
        included: [
          {
            name: widget,
            detail:
              "A live page that brings together a dated plan, the guest list with RSVP status, and a priced shopping list tracked against your budget, each item marked with its order-by date.",
          },
          {
            name: recurring,
            detail: "Tracks replies, and sends thank-you notes after the day.",
          },
        ],
      },
      {
        id: "inbox-triage",
        title: "Let me sort your inbox and keep only the mail that matters.",
        body: "Give me access to your inbox and I’ll keep watch, filtering out newsletters and routine notices so only the important mail that needs you remains, updated as new mail arrives.",
        category: "Productivity",
        included: [{ name: recurring, detail: "Keeps sorting your inbox." }],
      },
      {
        id: "forgotten-subscriptions",
        title: "I can find and cancel the subscriptions you forgot about.",
        body: "Connect your inbox and I’ll gather years of billing emails and card charges for every subscription you have, including free trials that quietly started charging. Say the word and I’ll cancel through each provider’s own process; if one blocks me, I’ll tell you why and give you the steps.",
        category: "Money management",
        included: [
          {
            name: recurring,
            detail: "Rescans every month for new charges and price increases.",
          },
        ],
      },
    ],
  },
  {
    title: "Relationships",
    ideas: [
      {
        id: "pet-care",
        title:
          "Tell me about your pets and I’ll keep their vaccines and food orders on schedule.",
        body: "Tell me about each pet once and I’ll build a schedule for every one of them covering vaccines, medicine and food, then set reminders to restock before supplies run out, so nothing slips by without you knowing.",
        category: "Relationships",
        included: [
          {
            name: widget,
            detail:
              "A tracker for each animal that records shots, medicine and supplies.",
          },
          {
            name: recurring,
            detail: "Reminders as booster, treatment and refill dates come up.",
          },
        ],
      },
      {
        id: "family-trivia-night",
        title: "Gather the family and I’ll host a live trivia night.",
        body: "Tell me who’s playing and pick your style: straight general knowledge, a board built from your own inside jokes and shared history, or both. Hints give the youngest players a chance to win, and a self-updating scoreboard is ready to play anytime in the TV’s browser.",
        category: "Relationships",
        included: [
          {
            name: widget,
            detail: "The game itself, playable right in a browser.",
          },
        ],
      },
      {
        id: "reconnect",
        title:
          "Drifted apart from someone? I’ll find a good time and draft the invite.",
        body: "Just list the people you want to see. I’ll scan your calendar for times you’re actually free, match them to each person, and draft an invite you can send with one tap.",
        category: "Relationships",
        included: [
          { name: recurring, detail: "Checks for open windows every week." },
        ],
      },
    ],
  },
  {
    title: "Productivity",
    ideas: [
      {
        id: "document-photos",
        title:
          "Snap a photo of a document. I’ll pay it, file it, and find it again when you need it.",
        body: "Share the picture and I’ll read what it asks for, then pay, fill in the details and file the PDF in the right place so you can find it later. I’ll check with you before anything that involves paying.",
        category: "Productivity",
        included: [
          {
            name: widget,
            detail:
              "Your filed documents, searchable by what’s in them rather than their names, with a record of what was done and when.",
          },
          {
            name: recurring,
            detail: "Watches warranty terms so you can claim before they end.",
          },
        ],
      },
      {
        id: "inbox-day-plan",
        title: "I can turn your inbox into a full plan for the day.",
        body: "Ask me anytime and I’ll read your inbox, calendar and open tasks, plan your day from them, and flag what needs a reply or what you agreed to in conversations. Send a screenshot or a sentence and I’ll create the calendar event for it.",
        category: "Productivity",
        included: [
          {
            name: recurring,
            detail:
              "A daily briefing, plus calendar entries whenever you send me something.",
          },
        ],
      },
      {
        id: "returns",
        title:
          "Tell me what you’re returning. I’ll set up the return and follow up on the refund.",
        body: "Tell me what you need to return and I’ll find the order in your email, work out the return deadline, give you the exact return link and everything the retailer asks for, and point you to the nearest drop-off. Then I’ll keep after the refund until the money is back in your account.",
        category: "Productivity",
        included: [
          {
            name: recurring,
            detail: "Watches the refund and follows up if it hasn’t arrived.",
          },
        ],
      },
    ],
  },
  {
    title: "Health & fitness",
    ideas: [
      {
        id: "habit-triggers",
        title:
          "Tell me a habit you want to break and I’ll remind you before the trigger hits.",
        body: "Together we’ll pin down the triggers, then I’ll put together a simple plan and remind you just before the moments you usually slip, not after.",
        category: "Health & fitness",
        included: [
          {
            name: widget,
            detail: "A streak tracker with your plan and check-in log.",
          },
          { name: recurring, detail: "Reminders at the moments that matter." },
        ],
      },
      {
        id: "equipment-workouts",
        title:
          "Tell me what equipment you have. I’ll build a whole workout plan around it.",
        body: "Show me a photo of your equipment and I’ll design a complete program around the space, your schedule and your goals. Tell me how your week looks and I’ll fit the training to your calendar and your recovery.",
        category: "Health & fitness",
        included: [
          {
            name: widget,
            detail: "A live workout log with today’s session and your history.",
          },
          {
            name: recurring,
            detail:
              "Start a new session whenever you like, or get a weekly plan on your calendar.",
          },
        ],
      },
      {
        id: "meal-photos",
        title: "Snap your meals and I’ll log every calorie.",
        body: "Take a photo or type a sentence and I’ll estimate the nutrition, log each ingredient and its calories, and keep today’s total updated right here. If a photo isn’t clear, I’ll check before logging it.",
        category: "Health & fitness",
        included: [{ name: recurring, detail: "A daily total." }],
      },
      {
        id: "follow-up-visits",
        title: "I’ll book the follow-up appointments you keep putting off.",
        body: "Send me your after-visit summary and I’ll read what’s due and by when, book whatever can be booked, and add the rest to your calendar with the right lead time and what to prepare. If there’s no online option, I’ll give you the phone number and exactly what to ask.",
        category: "Health & fitness",
        included: [
          {
            name: recurring,
            detail:
              "Keeps an eye on what’s coming up in the weeks and months ahead.",
          },
        ],
      },
    ],
  },
  {
    title: "Money management",
    ideas: [
      {
        id: "savings-goal",
        title:
          "Set a savings goal. When you drift off track, I’ll tell you what to cut.",
        body: "Tell me a goal and I’ll make you a live tracker. Every transaction is sorted as it posts and I’ll show you where your money went this week; if you drift from the plan, I’ll point to exactly which expense to cut to get back on track.",
        category: "Money management",
        included: [
          {
            name: widget,
            detail: "A live tracker with progress, projections and spending.",
          },
          {
            name: recurring,
            detail:
              "Recalculates every week and lets you know when your progress slows.",
          },
        ],
      },
      {
        id: "unclaimed-money",
        title:
          "Get back money that’s yours. I’ll check every state’s database.",
        body: "Let me search the states’ unclaimed property databases for your full name and every city you’ve lived in. Whatever I find, I’ll tell you what it is, who owes it and how much, then file the claim from start to finish.",
        category: "Money management",
        included: [
          {
            name: "Search",
            detail:
              "A one-time 50-state search and claim report, sent to the chat.",
          },
        ],
      },
      {
        id: "price-drop-refunds",
        title:
          "If something you bought drops in price, I can get you a refund.",
        body: "I’ll track your purchases and look for any way to pay less: a retailer price drop, your card’s price protection, or a promo code that appeared after you bought. When there’s a chance, I’ll file the claim and follow it from submission to payout without you having to remind me.",
        category: "Money management",
        included: [
          {
            name: recurring,
            detail: "Price checks within each item’s claim window.",
          },
          {
            name: widget,
            detail:
              "A live claims page: what you bought, what you paid, where each claim stands from submission to payout, and a running total of everything recovered.",
          },
        ],
      },
      {
        id: "rewards-cards",
        title:
          "I’ll pick the best rewards card for you and switch on its offers.",
        body: "Every card you carry hides rotating categories and personalized offers in your account. I’ll sign in and activate the ones worth turning on before they expire unused, and when you’re about to buy something, just ask and I’ll give you one answer: which card, and why.",
        category: "Money management",
        included: [
          {
            name: recurring,
            detail:
              "A monthly sweep that refreshes offers and activates the ones you need.",
          },
          {
            name: "Document",
            detail: "A checklist: live now, needs action, starting soon.",
          },
        ],
      },
    ],
  },
  {
    title: "Shopping",
    ideas: [
      {
        id: "side-by-side",
        title:
          "Tell me what you want to buy. I’ll lay out every option side by side.",
        body: "Weighing a car or a home? Tell me what matters to you and I’ll research the real options, surface the specs and prices people don’t volunteer, and build a side-by-side table that makes every trade-off clear so you can decide.",
        category: "Shopping",
        included: [
          {
            name: widget,
            detail: "A sortable comparison with scores and trade-offs.",
          },
        ],
      },
      {
        id: "marketplace-finds",
        title:
          "Let me hunt for finds on Marketplace. I’ll negotiate and arrange pickup.",
        body: "Tell me what you want and your top budget, and I’ll watch Marketplace around the clock. When the right item shows up, I’ll message the seller, negotiate from similar listings, and agree on a time and place, checking with you before confirming.",
        category: "Shopping",
        included: [
          {
            name: recurring,
            detail: "Sweeps every few hours while the hunt is open.",
          },
        ],
      },
      {
        id: "best-value",
        title:
          "Tell me what to buy. I’ll find the best-reviewed version at the best price.",
        body: "Describe it or send a photo and I’ll identify exactly what it is, read real user reviews instead of marketing, and compare every seller’s total delivered price. You’ll get the best pick and why it wins. Buy now, or tell me to keep watch and I’ll keep checking until there’s a sale, a coupon or a real price drop.",
        category: "Shopping",
        included: [
          {
            name: "Document",
            detail: "What I compared, and why this one won.",
          },
          {
            name: recurring,
            detail:
              "Not ready to buy? I’ll keep looking for deals, credits or price drops and tell you the moment there is one.",
          },
        ],
      },
    ],
  },
  {
    title: "More ideas",
    ideas: [
      {
        id: "id-renewals",
        title: "Tell me when your IDs expire and I’ll book the renewals.",
        body: "Tell me when your passport and driver’s license expire. I’ll work back from current processing times and book your renewal appointments early so nothing catches you out, and give you the checklist and photo rules so you’re fully prepared.",
        category: "Life hacks",
        included: [
          {
            name: recurring,
            detail:
              "Keeps watching each expiry date, working back from real turnaround times.",
          },
          {
            name: "Document",
            detail:
              "Pre-filled forms and a checklist of what you still need to provide.",
          },
        ],
      },
      {
        id: "daily-personality-quiz",
        title: "I’ll make you a new personality quiz every day.",
        body: "Answer two quick questions each day and a fresh quiz will be waiting: pick an option, move a slider, and see a result worth a screenshot. The next quiz only appears after you finish the last one, so they never pile up. Every quiz you take is kept in a private folder with its questions, answers and result, and you can retake any of them.",
        category: "Entertainment",
        included: [
          {
            name: widget,
            detail:
              "Your quiz keepsakes: today’s quiz, and every earlier one with your answers, results and retakes.",
          },
          {
            name: recurring,
            detail: "A new quiz unlocks each day once you finish the last one.",
          },
        ],
      },
      {
        id: "replacement-parts",
        title:
          "Snap a photo of the broken part. I’ll find and order the part you need.",
        body: "Send a photo or video of what’s broken and I’ll identify the exact part for your make and model. Once you confirm, I’ll order it and guide you through the repair, including the steps the manual leaves out.",
        category: "Home & vehicles",
        included: [
          {
            name: "Document",
            detail: "The part, where to get it, and the repair steps.",
          },
        ],
      },
      {
        id: "street-repairs",
        title:
          "Flag a pothole or a broken streetlight. I’ll work on getting it fixed.",
        body: "You send a photo and point out the problem. I’ll find out which department is responsible, file the report in the right words, and follow up on schedule until it’s resolved.",
        category: "Home & vehicles",
        included: [
          {
            name: recurring,
            detail: "Follows up every few days until the report is closed.",
          },
          {
            name: widget,
            detail:
              "The report you filed, plus a follow-up tracker with the reference number and every reply received.",
          },
        ],
      },
      {
        id: "home-project-quotes",
        title:
          "New home project? I’ll gather quotes and find the best contractors.",
        body: "Describe the work, your area and your timeline. I’ll write a clear brief, send it to every contractor you’ve approved, follow up with the ones who go quiet, and hand you all the replies side by side.",
        category: "Home & vehicles",
        included: [
          {
            name: widget,
            detail:
              "A side-by-side quote tracker: the locked scope, the questions sent, and each contractor’s quote, exclusions, timing and status, entered as their replies come in.",
          },
          {
            name: recurring,
            detail: "I follow up with anyone who hasn’t replied.",
          },
        ],
      },
      {
        id: "moving",
        title:
          "Getting ready to move? I’ll get quotes, book movers and file your change of address.",
        body: "Take a photo of each room and I’ll turn them into a detailed moving inventory, pull quotes from a few comparable movers and record your change of address, then build you a dated timeline so nothing gets missed in moving week.",
        category: "Home & vehicles",
        included: [
          {
            name: widget,
            detail:
              "Opens on a dated moving timeline, followed by room-by-room inventories, a comparison of mover quotes and a change-of-address checklist.",
          },
          {
            name: recurring,
            detail:
              "Follows up on anything stalled in the weeks before your date.",
          },
        ],
      },
      {
        id: "show-tickets",
        title:
          "Tell me the shows you can’t miss and I’ll grab tickets the moment they go on sale.",
        body: "Tell me the artists you have to see and I’ll track their shows within the distance you’re willing to travel. The moment tickets go on sale, I’ll join the queue, pick the seats and keep the total under your budget.",
        category: "Local",
        included: [
          { name: recurring, detail: "Keeps watching every artist you named." },
        ],
      },
      {
        id: "vibe-booking",
        title: "Tell me the vibe you want and I’ll book the right place.",
        body: "Tell me the mood you’re after and I’ll put together the right day out, or find a café with Wi‑Fi, outlets and enough quiet to think. I’ll check that it’s open and actually good, then book it and add the plan straight to your calendar.",
        category: "Local",
        included: [
          {
            name: "Document",
            detail:
              "A shortlist: each option with its hours, how busy it gets, the distance and why it made the cut.",
          },
        ],
      },
      {
        id: "weekend-plans",
        title:
          "Looking for fun this weekend? I can find what’s popular and get you tickets.",
        body: "I’ll scan events, shows and pop-ups nearby and filter them against your calendar and the forecast. For the ones you pick, I’ll take them straight to checkout with seats chosen and the total confirmed.",
        category: "Local",
        included: [{ name: recurring, detail: "Refreshed every week." }],
      },
      {
        id: "hotel-requests",
        title:
          "I’ll follow up on your booking so the crib, late checkout and allergy requests are all taken care of.",
        body: "Tell me what you need and I’ll message the hotel ahead of time to confirm: a crib in the room, late checkout, your allergies on file. If the hotel doesn’t reply, I’ll keep following up. Then I’ll tell you what the hotel confirmed in writing and what it won’t promise, while there’s still time to change plans.",
        category: "Travel",
        included: [
          {
            name: recurring,
            detail:
              "Follows up automatically when the property goes quiet, and checks before you travel that nothing is still unconfirmed.",
          },
        ],
      },
      {
        id: "flight-watch",
        title:
          "I’ll track your flights and let you know when anything changes.",
        body: "Give me your flight details however they reached you (a confirmation email, a calendar entry, pasted details) and I’ll watch the flight from then on: schedule changes, aircraft swaps, and cancellations while there’s still time to rebook. In the last 48 hours I’ll watch closely: the inbound flight, the gate, and any delay beyond your threshold. If you don’t hear from me, the flight is on track.",
        category: "Travel",
        included: [
          {
            name: recurring,
            detail:
              "Checks your booking daily, then watches from 48 hours out until you land.",
          },
        ],
      },
      {
        id: "trip-planner",
        title:
          "I can plan your trip and keep track of any changes as they happen.",
        body: "Tell me where and when, and I’ll build your itinerary. If your email is connected, I’ll pull in flight and hotel confirmations automatically, keep the itinerary up to date, and watch for price and booking changes throughout the trip.",
        category: "Travel",
        included: [
          {
            name: widget,
            detail: "A live itinerary that updates as your bookings change.",
          },
          {
            name: recurring,
            detail:
              "I watch booking emails, similar prices and live flight status to catch the changes that matter.",
          },
        ],
      },
    ],
  },
];

export const catalogIdeas = ideaCatalog.flatMap((section) => section.ideas);

export function catalogIdea(id: string) {
  return catalogIdeas.find((idea) => idea.id === id);
}

// Every authored line of the catalog, for translation checks.
export function catalogCopy() {
  return [
    ...ideaCatalog.flatMap((section) => (section.title ? [section.title] : [])),
    ...catalogIdeas.flatMap((idea) => [
      idea.title,
      idea.body,
      idea.category,
      ...(idea.included ?? []).flatMap((row) => [row.name, row.detail]),
    ]),
  ];
}

// What this device remembers about catalog ideas: ones the person wants more
// of, and ones they asked not to see again.
export type IdeaCatalogState = { liked: string[]; hidden: string[] };
export const emptyIdeaCatalogState = (): IdeaCatalogState => ({
  liked: [],
  hidden: [],
});
// Where that is kept for one workspace (or for this device while signed out).
export const ideaCatalogKey = (scope: string) =>
  `${scope}:inspiration:catalog:v1`;
