import type { Category } from "../shared/types";

export const categories: Record<Category, string> = {
  general: "Everyday helper",
  research: "Deep research",
  writing: "Writing & ideas",
  life: "Life planning",
  code: "Code & tools",
};
export const templates: {
  id: string;
  title: string;
  detail: string;
  prompt: string;
  category: Category;
  art: string;
}[] = [
  {
    id: "weekend",
    title: "A quiet weekend escape",
    detail: "An unhurried trip starts here",
    prompt:
      "Help me plan a relaxed two-day weekend getaway. First ask where I'm starting from, my destination, budget, and preferences, then put together an unhurried itinerary.",
    category: "life",
    art: "landscape",
  },
  {
    id: "research",
    title: "Turn curiosity into evidence",
    detail: "Research a topic and map the key viewpoints",
    prompt:
      "I want to dig into a new topic. Please first ask me what the subject is and what I'll use it for, then outline a research framework; cite sources when you reference material and distinguish facts from speculation.",
    category: "research",
    art: "orbit",
  },
  {
    id: "writing",
    title: "Get the ideas in your head onto paper",
    detail: "From a single thought to a finished piece",
    prompt:
      "Help me turn an idea into a clear article with my own voice. First get to know my core point, target readers, and where I'll publish it.",
    category: "writing",
    art: "paper",
  },
  {
    id: "email",
    title: "Draft it for me, wait for my okay",
    detail: "Try an action that needs approval",
    prompt:
      "Help me draft an email with a project update. Confirm the recipients and content with me first, and ask for my approval before sending.",
    category: "writing",
    art: "mail",
  },
  {
    id: "code",
    title: "One idea, one little tool",
    detail: "Turn repetitive work into automation",
    prompt:
      "I want to build a small tool that removes repetitive work. Please first understand my workflow, inputs and outputs, and the environment it runs in, then give me a minimal working implementation and a way to verify it.",
    category: "code",
    art: "code",
  },
  {
    id: "read",
    title: "Understanding matters more than finishing",
    detail: "Extract the structure, arguments, and questions",
    prompt:
      "Help me analyze a piece of material. I'll share the text next; please distill the core conclusions, the structure of the reasoning, the assumptions at play, and the questions worth following up on.",
    category: "research",
    art: "book",
  },
];
