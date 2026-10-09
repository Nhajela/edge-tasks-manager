import { Column, SectionTitle } from "@/components/bits";
import { Glossary } from "./Glossary";
import { Steps } from "./Steps";

/** Landing-page tutorial: the steps first, the dictionary below. */
export function Tutorial({ bot }: { bot: string }) {
  return (
    <Column wide className="flex flex-col gap-12 py-10 sm:gap-16 sm:py-16">
      <section id="how" className="flex flex-col gap-5">
        <SectionTitle aside="8 steps">How it works in 60 seconds</SectionTitle>
        <Steps bot={bot} />
      </section>
      <section id="dictionary" className="flex flex-col gap-5">
        <SectionTitle aside="search below">Every command and word</SectionTitle>
        <Glossary bot={bot} />
      </section>
    </Column>
  );
}
