import shramp from "@/assets/characters/shramp.png";
import moncock from "@/assets/characters/moncock.png";
import emonad from "@/assets/characters/emonad.png";
import bob from "@/assets/characters/bob.png";
import chog from "@/assets/characters/chog.png";

export type Character = {
  id: string;
  name: string;
  image: string;
};

export const CHARACTERS: Character[] = [
  { id: "shramp", name: "Shramp", image: shramp },
  { id: "moncock", name: "Moncock", image: moncock },
  { id: "emonad", name: "Emonad", image: emonad },
  { id: "bob", name: "Bob", image: bob },
  { id: "chog", name: "Chog", image: chog },
];
