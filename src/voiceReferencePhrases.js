// Local reading prompts: no model, network request, or personal context needed.
export const VOICE_PHRASE_MOODS = {
  surprise: 'Surprise me',
  cozy: 'Cozy chaos',
  space: 'Space nonsense',
  adventure: 'Tiny adventures',
  detective: 'Detective drama',
};

const fragments = {
  cozy: [
    [
      'My toaster has started giving life advice, and honestly, the bagels seem happier than ever.',
      'A tiny dragon moved into my teapot, so every cup now comes with a weather forecast.',
      'At breakfast, a very polite raccoon asked whether the pancakes came with a loyalty program.',
      'The houseplants held a meeting this morning and voted to give the sofa a holiday.',
    ],
    [
      'Nobody panicked. We simply poured another cup of tea and asked for details.',
      'Even the cat looked impressed, although it refused to put that in writing.',
      'I nodded politely, then checked whether the kettle had joined the conversation.',
      'Was this sensible? Probably not, but the kitchen had never felt so ambitious.',
    ],
    ['Tomorrow, we discuss the biscuits.', 'Please bring your own tiny spoon.', 'I suspect the marmalade knows more.', 'Somehow, this counts as a normal Tuesday.'],
  ],
  space: [
    [
      'Mission control has a small problem: the moon is wearing our best pair of dancing shoes.',
      'Our spaceship has discovered a planet where every official announcement must begin with a compliment.',
      'The captain just promoted a rubber duck to chief engineer, and morale has improved dramatically.',
      'Somewhere beyond Saturn, a lonely vending machine is preparing to open the first interstellar bakery.',
    ],
    [
      'We checked the instruments twice. Apparently, the universe has an excellent sense of humor.',
      'I asked for an explanation, but the computer would only offer warm encouragement.',
      'Is this in the flight manual? No, but neither was yesterday’s cheese emergency.',
      'The crew remained calm and agreed to investigate immediately after a sensible lunch.',
    ],
    ['Please fasten your imaginary seat belts.', 'Next stop: somewhere with better snacks.', 'We may need a bigger sandwich.', 'Space is strange. Pack extra socks.'],
  ],
  adventure: [
    [
      'I followed a mysterious trail of glitter and found a hedgehog selling maps to imaginary kingdoms.',
      'A wizard offered me three wishes, but first I had to help him find his glasses.',
      'The bridge was guarded by a tiny troll who demanded a compliment instead of a toll.',
      'At the edge of the forest, a squirrel handed me a treasure map and a biscuit.',
    ],
    [
      'Naturally, I asked a few questions. The answers raised several more, which felt promising.',
      'Was I prepared for adventure? Not remotely, but I had comfortable shoes and enthusiasm.',
      'The instructions were surprisingly clear: stay curious, walk slowly, and be kind to mushrooms.',
      'I took a deep breath and decided this was considerably better than doing laundry.',
    ],
    ['The quest could wait until after tea.', 'Every great story needs a snack.', 'That is how Tuesday became legendary.', 'Please tell the dragon I said hello.'],
  ],
  detective: [
    [
      'The case began with a missing cupcake, a suspicious umbrella, and a parrot who knew too much.',
      'Someone had stolen the mayor’s left slipper, and every garden gnome in town had an alibi.',
      'I arrived at the library to find a trail of crumbs and one extremely nervous dictionary.',
      'The clock struck midnight, the door creaked open, and a penguin asked to speak to my manager.',
    ],
    [
      'Coincidence? Perhaps. I adjusted my hat and made a very serious note about the weather.',
      'The clues were baffling, but I had a notebook, a sharp pencil, and excellent biscuits.',
      'Nobody would talk, although the house cat offered to cooperate in exchange for dinner.',
      'I asked the obvious question. The answer was no, followed by a deeply suspicious sneeze.',
    ],
    ['Clearly, the plot was getting buttery.', 'This mystery would require another pot of tea.', 'I knew the goldfish was hiding something.', 'Case closed. Sandwiches all around.'],
  ],
};

const phrases = Object.entries(fragments).flatMap(([mood, [openings, middles, endings]]) =>
  openings.flatMap(opening => middles.flatMap(middle => endings.map(ending => ({
    mood, text: `${opening} ${middle} ${ending}`,
  })))));

export function newVoiceReferencePhrase(mood = 'surprise', previous = '') {
  const choices = phrases.filter(phrase => (mood === 'surprise' || phrase.mood === mood) && phrase.text !== previous);
  const available = choices.length ? choices : phrases;
  return available[Math.floor(Math.random() * available.length)];
}
