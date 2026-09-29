/**
 * The grocery dictionary: what things are called, in English, Hindi/Hinglish
 * and a few regional names, and how much of each a household usually buys.
 *
 * It drives three things: autocomplete, understanding a list row
 * ("pyaz" → onion), and deciding what *kind* of product a listing is, so that
 * "milk" never matches milk chocolate. The key is the canonical phrase; an
 * item with a `parent` is a kind of that parent ("toor dal" is a "dal"), so a
 * row for the parent accepts any child.
 */
import type { Unit } from './types';
import { findSequence, phonetic, tokenize } from './text';

export type Category =
  | 'vegetables'
  | 'fruits'
  | 'dairy'
  | 'eggs'
  | 'bakery'
  | 'breakfast'
  | 'staples'
  | 'dal'
  | 'oil'
  | 'spices'
  | 'dry-fruits'
  | 'snacks'
  | 'beverages'
  | 'condiments'
  | 'instant'
  | 'meat'
  | 'household'
  | 'personal'
  | 'baby'
  | 'pet';

export interface DictItem {
  key: string;
  name: string;
  category: Category;
  amount: number;
  unit: Unit;
  aliases: string[];
  /** What platforms call it, when that differs from the key. */
  search: string;
  parent: string | null;
  /** g per ml, for items sold both by weight and by volume (ghee, oil, honey). */
  density: number | null;
  /** A pack without an explicit count is one piece (a cauliflower, a bar of soap). */
  discrete: boolean;
  emoji: string;
}

interface Extra {
  search?: string;
  parent?: string;
  density?: number;
  discrete?: boolean;
  emoji?: string;
}

type Raw = [key: string, name: string, category: Category, amount: number, unit: Unit, aliases: string[], extra?: Extra];

const OIL = { density: 0.91, parent: 'cooking oil', emoji: '🫗' };

const RAW: Raw[] = [
  // --- vegetables -----------------------------------------------------------
  ['onion', 'Onion', 'vegetables', 1, 'kg', ['pyaz', 'pyaaz', 'piaz', 'kanda', 'eerulli', 'vengayam', 'ulli', 'onions'], { emoji: '🧅' }],
  ['potato', 'Potato', 'vegetables', 1, 'kg', ['aloo', 'alu', 'aalu', 'batata', 'urulai', 'potatoes'], { emoji: '🥔' }],
  ['tomato', 'Tomato', 'vegetables', 1, 'kg', ['tamatar', 'tamater', 'thakkali', 'tomatoes'], { emoji: '🍅' }],
  ['garlic', 'Garlic', 'vegetables', 250, 'g', ['lehsun', 'lahsun', 'lasun', 'lassan', 'bellulli', 'poondu'], { emoji: '🧄' }],
  ['ginger', 'Ginger', 'vegetables', 250, 'g', ['adrak', 'adrakh', 'allam', 'shunti', 'inji'], { emoji: '🫚' }],
  ['green chilli', 'Green Chilli', 'vegetables', 100, 'g', ['hari mirch', 'hari mirchi', 'mirchi', 'green chillies', 'green chili', 'chilli', 'chili'], { emoji: '🌶️' }],
  ['lemon', 'Lemon', 'vegetables', 250, 'g', ['nimbu', 'limbu', 'lime', 'lemons', 'elumichai'], { emoji: '🍋' }],
  ['coriander leaves', 'Coriander Leaves', 'vegetables', 100, 'g', ['dhania', 'dhaniya', 'dhania patta', 'kothmir', 'kothimbir', 'cilantro', 'coriander', 'hara dhania'], { search: 'coriander', emoji: '🌿' }],
  ['mint', 'Mint Leaves', 'vegetables', 100, 'g', ['pudina', 'pudhina', 'mint leaves'], { emoji: '🌿' }],
  ['curry leaves', 'Curry Leaves', 'vegetables', 100, 'g', ['kadi patta', 'kadipatta', 'kari patta', 'karibevu', 'curry patta'], { emoji: '🌿' }],
  ['spinach', 'Spinach', 'vegetables', 250, 'g', ['palak', 'palakura', 'keerai'], { emoji: '🥬' }],
  ['methi leaves', 'Methi Leaves', 'vegetables', 250, 'g', ['methi', 'fenugreek leaves', 'methi saag'], { search: 'methi', emoji: '🌿' }],
  ['cauliflower', 'Cauliflower', 'vegetables', 1, 'pcs', ['gobi', 'gobhi', 'phool gobi', 'phool gobhi', 'cauli flower'], { discrete: true, emoji: '🥦' }],
  ['cabbage', 'Cabbage', 'vegetables', 1, 'pcs', ['patta gobi', 'patta gobhi', 'band gobhi', 'bandh gobi', 'kosu'], { discrete: true, emoji: '🥬' }],
  ['carrot', 'Carrot', 'vegetables', 500, 'g', ['gajar', 'carrots'], { emoji: '🥕' }],
  ['cucumber', 'Cucumber', 'vegetables', 500, 'g', ['kheera', 'khira', 'kakdi', 'kakri'], { emoji: '🥒' }],
  ['capsicum', 'Capsicum', 'vegetables', 250, 'g', ['shimla mirch', 'shimla mirchi', 'bell pepper', 'green capsicum'], { emoji: '🫑' }],
  ['brinjal', 'Brinjal', 'vegetables', 500, 'g', ['baingan', 'baigan', 'eggplant', 'vankaya', 'kathirikai', 'badanekai'], { emoji: '🍆' }],
  ['lady finger', 'Lady Finger', 'vegetables', 500, 'g', ['bhindi', 'okra', 'ladies finger', 'vendakkai', 'bendekai'], { search: 'bhindi', emoji: '🫛' }],
  ['bottle gourd', 'Bottle Gourd', 'vegetables', 1, 'pcs', ['lauki', 'ghiya', 'dudhi', 'sorakaya', 'sorekai'], { discrete: true, emoji: '🥒' }],
  ['bitter gourd', 'Bitter Gourd', 'vegetables', 250, 'g', ['karela', 'pavakkai', 'hagalakai'], { emoji: '🥒' }],
  ['beans', 'French Beans', 'vegetables', 250, 'g', ['french beans', 'farsi', 'green beans', 'beans'], { emoji: '🫛' }],
  ['peas', 'Green Peas', 'vegetables', 500, 'g', ['matar', 'mutter', 'green peas', 'hara matar'], { emoji: '🫛' }],
  ['sweet corn', 'Sweet Corn', 'vegetables', 1, 'pcs', ['bhutta', 'corn', 'makai', 'american corn'], { discrete: true, emoji: '🌽' }],
  ['mushroom', 'Mushroom', 'vegetables', 200, 'g', ['khumb', 'button mushroom', 'mushrooms'], { emoji: '🍄' }],
  ['beetroot', 'Beetroot', 'vegetables', 500, 'g', ['chukandar', 'beet'], { emoji: '🫜' }],
  ['radish', 'Radish', 'vegetables', 500, 'g', ['mooli', 'muli'], { emoji: '🥕' }],
  ['pumpkin', 'Pumpkin', 'vegetables', 1, 'kg', ['kaddu', 'kaddoo', 'bhopla', 'poosanikai'], { emoji: '🎃' }],
  ['drumstick', 'Drumstick', 'vegetables', 250, 'g', ['moringa', 'sahjan', 'murungakkai', 'shevga'], { emoji: '🥢' }],
  ['sweet potato', 'Sweet Potato', 'vegetables', 500, 'g', ['shakarkandi', 'shakarkand', 'genasu'], { emoji: '🍠' }],
  ['spring onion', 'Spring Onion', 'vegetables', 100, 'g', ['hara pyaz', 'green onion', 'scallion'], { emoji: '🧅' }],
  ['shallots', 'Sambar Onion', 'vegetables', 500, 'g', ['sambar onion', 'samber onion', 'small onion', 'small onions', 'chinna vengayam', 'sambar eerulli', 'sambar irulli', 'madras onion', 'pearl onion'], { search: 'sambar onion', emoji: '🧅' }],
  ['broccoli', 'Broccoli', 'vegetables', 1, 'pcs', ['brocoli'], { discrete: true, emoji: '🥦' }],
  ['raw banana', 'Raw Banana', 'vegetables', 500, 'g', ['kacha kela', 'kachha kela', 'plantain', 'vazhakkai'], { emoji: '🍌' }],
  ['coconut', 'Coconut', 'vegetables', 1, 'pcs', ['nariyal', 'thengai', 'tender coconut', 'kobbari'], { discrete: true, emoji: '🥥' }],
  ['baby corn', 'Baby Corn', 'vegetables', 200, 'g', [], { emoji: '🌽' }],

  // --- fruits ---------------------------------------------------------------
  ['banana', 'Banana', 'fruits', 6, 'pcs', ['kela', 'kele', 'bananas', 'robusta banana', 'elaichi banana'], { emoji: '🍌' }],
  ['apple', 'Apple', 'fruits', 1, 'kg', ['seb', 'saib', 'apples', 'shimla apple'], { emoji: '🍎' }],
  ['orange', 'Orange', 'fruits', 1, 'kg', ['santra', 'narangi', 'oranges', 'kinnow'], { emoji: '🍊' }],
  ['mango', 'Mango', 'fruits', 1, 'kg', ['aam', 'alphonso', 'mangoes', 'hapus'], { emoji: '🥭' }],
  ['grapes', 'Grapes', 'fruits', 500, 'g', ['angoor', 'angur', 'grape'], { emoji: '🍇' }],
  ['papaya', 'Papaya', 'fruits', 1, 'pcs', ['papita'], { discrete: true, emoji: '🍈' }],
  ['watermelon', 'Watermelon', 'fruits', 1, 'pcs', ['tarbooz', 'tarbuj', 'kalingad'], { discrete: true, emoji: '🍉' }],
  ['pomegranate', 'Pomegranate', 'fruits', 500, 'g', ['anar', 'anaar', 'dalimb'], { emoji: '🍎' }],
  ['guava', 'Guava', 'fruits', 500, 'g', ['amrood', 'amrud', 'peru', 'jamfal'], { emoji: '🍐' }],
  ['pineapple', 'Pineapple', 'fruits', 1, 'pcs', ['ananas', 'ananas fruit'], { discrete: true, emoji: '🍍' }],
  ['kiwi', 'Kiwi', 'fruits', 3, 'pcs', ['kiwis'], { emoji: '🥝' }],
  ['strawberry', 'Strawberry', 'fruits', 200, 'g', ['strawberries'], { emoji: '🍓' }],
  ['chikoo', 'Chikoo', 'fruits', 500, 'g', ['sapota', 'chiku', 'sapodilla'], { emoji: '🟤' }],
  ['pear', 'Pear', 'fruits', 500, 'g', ['nashpati', 'naspati', 'pears'], { emoji: '🍐' }],
  ['muskmelon', 'Muskmelon', 'fruits', 1, 'pcs', ['kharbooja', 'kharbuja', 'cantaloupe'], { discrete: true, emoji: '🍈' }],
  ['avocado', 'Avocado', 'fruits', 2, 'pcs', [], { emoji: '🥑' }],

  // --- dairy & eggs ---------------------------------------------------------
  ['milk', 'Milk', 'dairy', 1, 'L', ['doodh', 'dudh', 'toned milk', 'paal', 'haalu'], { density: 1.03, emoji: '🥛' }],
  ['curd', 'Curd', 'dairy', 500, 'g', ['dahi', 'yogurt', 'yoghurt', 'thayir', 'mosaru', 'perugu'], { density: 1.0, emoji: '🥣' }],
  ['butter', 'Butter', 'dairy', 500, 'g', ['makkhan', 'makhan', 'white butter'], { emoji: '🧈' }],
  ['paneer', 'Paneer', 'dairy', 200, 'g', ['cottage cheese'], { emoji: '🧀' }],
  ['cheese', 'Cheese', 'dairy', 200, 'g', ['cheese slices', 'cheese cubes', 'cheese block', 'mozzarella'], { emoji: '🧀' }],
  ['ghee', 'Ghee', 'dairy', 1, 'L', ['desi ghee', 'cow ghee', 'clarified butter', 'tuppa', 'neyyi', 'nei'], { density: 0.91, emoji: '🫙' }],
  ['buttermilk', 'Buttermilk', 'dairy', 500, 'ml', ['chaas', 'chaach', 'butter milk', 'majjige', 'mor', 'masala chaas'], { density: 1.0, emoji: '🥛' }],
  ['lassi', 'Lassi', 'dairy', 200, 'ml', [], { density: 1.0, emoji: '🥛' }],
  ['cream', 'Fresh Cream', 'dairy', 200, 'ml', ['fresh cream', 'malai', 'cooking cream'], { density: 1.0, emoji: '🥛' }],
  ['eggs', 'Eggs', 'eggs', 12, 'pcs', ['egg', 'anda', 'ande', 'brown eggs', 'white eggs', 'mutta'], { emoji: '🥚' }],
  ['quail eggs', 'Quail Eggs', 'eggs', 12, 'pcs', ['quail egg', 'kaadai eggs', 'bater eggs'], { emoji: '🥚' }],
  ['duck eggs', 'Duck Eggs', 'eggs', 6, 'pcs', ['duck egg'], { emoji: '🥚' }],
  ['khoya', 'Khoya', 'dairy', 200, 'g', ['mawa', 'khoa'], { emoji: '🧀' }],
  ['condensed milk', 'Condensed Milk', 'dairy', 400, 'g', ['milkmaid', 'milk maid'], { emoji: '🥫' }],
  ['milk powder', 'Milk Powder', 'dairy', 500, 'g', ['dairy whitener', 'everyday milk powder'], { emoji: '🥛' }],
  ['tofu', 'Tofu', 'dairy', 200, 'g', ['soya paneer'], { emoji: '🧈' }],

  // --- bakery & breakfast ---------------------------------------------------
  ['bread', 'Bread', 'bakery', 1, 'pack', ['double roti', 'white bread', 'sandwich bread', 'loaf'], { emoji: '🍞' }],
  ['pav', 'Pav', 'bakery', 1, 'pack', ['pao', 'ladi pav', 'pav bun'], { emoji: '🍞' }],
  ['bun', 'Buns', 'bakery', 1, 'pack', ['buns', 'burger bun'], { emoji: '🍔' }],
  ['rusk', 'Rusk', 'bakery', 1, 'pack', ['toast', 'rusks', 'cake rusk'], { emoji: '🍞' }],
  ['cake', 'Cake', 'bakery', 1, 'pack', ['cakes', 'muffin', 'cup cake'], { emoji: '🍰' }],
  ['oats', 'Oats', 'breakfast', 500, 'g', ['oat', 'rolled oats', 'oatmeal'], { emoji: '🥣' }],
  ['cornflakes', 'Corn Flakes', 'breakfast', 500, 'g', ['corn flakes', 'cornflake'], { emoji: '🥣' }],
  ['muesli', 'Muesli', 'breakfast', 500, 'g', ['granola'], { emoji: '🥣' }],
  ['poha', 'Poha', 'staples', 500, 'g', ['pohe', 'aval', 'avalakki', 'flattened rice', 'beaten rice'], { emoji: '🍚' }],
  ['peanut butter', 'Peanut Butter', 'breakfast', 500, 'g', [], { emoji: '🥜' }],
  ['jam', 'Jam', 'breakfast', 500, 'g', ['fruit jam', 'mixed fruit jam'], { emoji: '🍓' }],
  ['honey', 'Honey', 'breakfast', 500, 'g', ['shahad', 'shahad honey', 'madhu', 'jenu'], { density: 1.4, emoji: '🍯' }],
  ['chocolate spread', 'Chocolate Spread', 'breakfast', 350, 'g', ['nutella', 'hazelnut spread'], { emoji: '🍫' }],

  // --- staples --------------------------------------------------------------
  ['atta', 'Atta', 'staples', 5, 'kg', ['wheat flour', 'gehu atta', 'gehun atta', 'gehu ka atta', 'chakki atta', 'whole wheat flour', 'godhi hittu', 'wheat atta'], { emoji: '🌾' }],
  ['maida', 'Maida', 'staples', 1, 'kg', ['all purpose flour', 'refined flour', 'plain flour'], { emoji: '🌾' }],
  ['besan', 'Besan', 'staples', 500, 'g', ['gram flour', 'chickpea flour', 'kadalai maavu', 'kadle hittu', 'chana besan'], { emoji: '🌾' }],
  ['sooji', 'Sooji', 'staples', 500, 'g', ['suji', 'rava', 'rawa', 'semolina', 'bombay rava', 'upma rava'], { emoji: '🌾' }],
  ['rice', 'Rice', 'staples', 5, 'kg', ['chawal', 'chaval', 'akki', 'arisi', 'biyyam'], { emoji: '🍚' }],
  ['sugar', 'Sugar', 'staples', 1, 'kg', ['chini', 'cheeni', 'shakkar', 'sakkare', 'sarkarai'], { emoji: '🍬' }],
  ['jaggery', 'Jaggery', 'staples', 500, 'g', ['gud', 'gur', 'bellam', 'vellam', 'bella'], { emoji: '🟫' }],
  ['salt', 'Salt', 'staples', 1, 'kg', ['namak', 'uppu', 'iodised salt', 'iodized salt'], { emoji: '🧂' }],
  ['rock salt', 'Rock Salt', 'staples', 500, 'g', ['sendha namak', 'sendha salt', 'pink salt'], { parent: 'salt', emoji: '🧂' }],
  ['black salt', 'Black Salt', 'staples', 100, 'g', ['kala namak'], { parent: 'salt', emoji: '🧂' }],
  ['tea', 'Tea', 'beverages', 500, 'g', ['chai', 'chai patti', 'tea leaves', 'tea powder', 'tea dust', 'chaha'], { emoji: '🍵' }],
  ['green tea', 'Green Tea', 'beverages', 1, 'pack', ['green tea bags'], { parent: 'tea', emoji: '🍵' }],
  ['coffee', 'Coffee', 'beverages', 200, 'g', ['kaapi', 'filter coffee', 'instant coffee', 'coffee powder'], { emoji: '☕' }],
  ['vermicelli', 'Vermicelli', 'staples', 500, 'g', ['seviyan', 'sevai', 'semiya', 'shavige'], { emoji: '🍜' }],
  ['sabudana', 'Sabudana', 'staples', 500, 'g', ['sago', 'tapioca pearls', 'javvarisi'], { emoji: '⚪' }],
  ['dalia', 'Dalia', 'staples', 500, 'g', ['daliya', 'broken wheat', 'lapsi', 'godhumai rava'], { emoji: '🌾' }],
  ['ragi flour', 'Ragi Flour', 'staples', 1, 'kg', ['ragi', 'nachni', 'finger millet', 'ragi atta'], { emoji: '🌾' }],
  ['jowar flour', 'Jowar Flour', 'staples', 1, 'kg', ['jowar', 'jowar atta', 'sorghum flour'], { emoji: '🌾' }],
  ['bajra flour', 'Bajra Flour', 'staples', 1, 'kg', ['bajra', 'bajra atta', 'pearl millet flour'], { emoji: '🌾' }],
  ['rice flour', 'Rice Flour', 'staples', 500, 'g', ['chawal ka atta', 'akki hittu', 'rice atta'], { emoji: '🌾' }],
  ['corn flour', 'Corn Flour', 'staples', 500, 'g', ['cornflour', 'corn starch', 'cornstarch'], { emoji: '🌽' }],
  ['maize flour', 'Maize Flour', 'staples', 1, 'kg', ['makki atta', 'makki ka atta'], { emoji: '🌽' }],
  ['millet', 'Millets', 'staples', 500, 'g', ['foxtail millet', 'kodo millet', 'little millet'], { emoji: '🌾' }],
  ['papad', 'Papad', 'staples', 200, 'g', ['appalam', 'pappad', 'papadum', 'happala'], { emoji: '🫓' }],
  ['baking soda', 'Baking Soda', 'staples', 100, 'g', ['meetha soda', 'cooking soda', 'soda bicarbonate', 'sodium bicarbonate'], { emoji: '🧂' }],
  ['puffed rice', 'Puffed Rice', 'staples', 250, 'g', ['murmura', 'kurmura', 'mandakki', 'pori', 'muri'], { emoji: '🍚' }],
  ['sweetener', 'Sweetener', 'staples', 1, 'pack', ['sugar free', 'stevia', 'sugarfree'], { emoji: '🍬' }],

  // --- dals & pulses ----------------------------------------------------------
  ['dal', 'Dal', 'dal', 1, 'kg', ['daal', 'lentil', 'lentils', 'pulses', 'paruppu', 'bele'], { emoji: '🫘' }],
  ['toor dal', 'Toor Dal', 'dal', 1, 'kg', ['arhar dal', 'tur dal', 'tuvar dal', 'toovar dal', 'togari bele', 'thuvaram paruppu', 'kandi pappu', 'toor', 'arhar', 'tuvar'], { parent: 'dal', emoji: '🫘' }],
  ['moong dal', 'Moong Dal', 'dal', 1, 'kg', ['mung dal', 'moong', 'yellow moong dal', 'pesarapappu', 'pasi paruppu', 'hesaru bele'], { parent: 'dal', emoji: '🫘' }],
  ['masoor dal', 'Masoor Dal', 'dal', 1, 'kg', ['masur dal', 'red lentils', 'malka masoor', 'masoor'], { parent: 'dal', emoji: '🫘' }],
  ['chana dal', 'Chana Dal', 'dal', 1, 'kg', ['channa dal', 'bengal gram dal', 'kadale bele', 'kadalai paruppu', 'senagapappu'], { parent: 'dal', emoji: '🫘' }],
  ['urad dal', 'Urad Dal', 'dal', 1, 'kg', ['udad dal', 'urad', 'black gram dal', 'uddina bele', 'ulundu', 'minapappu'], { parent: 'dal', emoji: '🫘' }],
  ['rajma', 'Rajma', 'dal', 500, 'g', ['kidney beans', 'rajmah', 'red kidney beans'], { emoji: '🫘' }],
  ['kabuli chana', 'Kabuli Chana', 'dal', 500, 'g', ['chickpeas', 'chole', 'chhole', 'white chana', 'garbanzo', 'kabuli chickpeas'], { emoji: '🫘' }],
  ['kala chana', 'Kala Chana', 'dal', 500, 'g', ['black chana', 'black chickpeas', 'brown chana', 'chana', 'desi chana'], { emoji: '🫘' }],
  ['green moong', 'Whole Moong', 'dal', 500, 'g', ['sabut moong', 'whole moong', 'green gram', 'moong whole'], { emoji: '🫘' }],
  ['lobia', 'Lobia', 'dal', 500, 'g', ['black eyed peas', 'chawli', 'cowpeas', 'alasande'], { emoji: '🫘' }],
  ['matki', 'Matki', 'dal', 500, 'g', ['moth beans', 'moth dal'], { emoji: '🫘' }],
  ['soya chunks', 'Soya Chunks', 'dal', 200, 'g', ['soya bari', 'soya badi', 'meal maker', 'nutrela', 'soya nuggets'], { emoji: '🟤' }],

  // --- oils -------------------------------------------------------------------
  ['cooking oil', 'Cooking Oil', 'oil', 1, 'L', ['oil', 'tel', 'refined oil', 'vegetable oil', 'edible oil'], { density: 0.91, emoji: '🫗' }],
  ['sunflower oil', 'Sunflower Oil', 'oil', 1, 'L', ['surajmukhi tel', 'refined sunflower oil'], OIL],
  ['mustard oil', 'Mustard Oil', 'oil', 1, 'L', ['sarson tel', 'sarson ka tel', 'kachi ghani', 'kachchi ghani'], OIL],
  ['groundnut oil', 'Groundnut Oil', 'oil', 1, 'L', ['peanut oil', 'moongphali tel', 'kadalai ennai', 'filtered groundnut oil'], OIL],
  ['coconut oil', 'Coconut Oil', 'oil', 500, 'ml', ['nariyal tel', 'thengai ennai', 'kobbari nune'], OIL],
  ['olive oil', 'Olive Oil', 'oil', 500, 'ml', ['extra virgin olive oil'], OIL],
  ['rice bran oil', 'Rice Bran Oil', 'oil', 1, 'L', [], OIL],
  ['sesame oil', 'Sesame Oil', 'oil', 500, 'ml', ['til oil', 'til tel', 'gingelly oil', 'nallennai', 'til ka tel'], OIL],
  ['soybean oil', 'Soybean Oil', 'oil', 1, 'L', ['soya oil', 'soyabean oil'], OIL],
  ['vanaspati', 'Vanaspati', 'oil', 1, 'L', ['dalda', 'hydrogenated oil'], { density: 0.91, emoji: '🫙' }],

  // --- spices -----------------------------------------------------------------
  ['turmeric powder', 'Turmeric Powder', 'spices', 100, 'g', ['haldi', 'haldi powder', 'turmeric', 'manjal', 'arishina'], { emoji: '🟡' }],
  ['red chilli powder', 'Red Chilli Powder', 'spices', 100, 'g', ['lal mirch', 'lal mirch powder', 'mirchi powder', 'chilli powder', 'kashmiri mirch', 'kashmiri chilli powder', 'red chili powder'], { emoji: '🌶️' }],
  ['coriander powder', 'Coriander Powder', 'spices', 100, 'g', ['dhania powder', 'dhaniya powder'], { emoji: '🟤' }],
  ['cumin', 'Jeera', 'spices', 100, 'g', ['jeera', 'zeera', 'jira', 'cumin seeds', 'jeerakam', 'jeerige'], { search: 'jeera', emoji: '🟤' }],
  ['cumin powder', 'Jeera Powder', 'spices', 100, 'g', ['jeera powder', 'roasted jeera powder'], { emoji: '🟤' }],
  ['mustard seeds', 'Mustard Seeds', 'spices', 100, 'g', ['rai', 'sarson', 'sasive', 'kadugu', 'mohri'], { emoji: '🟤' }],
  ['garam masala', 'Garam Masala', 'spices', 100, 'g', [], { emoji: '🟤' }],
  ['chaat masala', 'Chaat Masala', 'spices', 100, 'g', ['chat masala'], { emoji: '🟤' }],
  ['chole masala', 'Chole Masala', 'spices', 100, 'g', ['chana masala'], { emoji: '🟤' }],
  ['pav bhaji masala', 'Pav Bhaji Masala', 'spices', 100, 'g', [], { emoji: '🟤' }],
  ['sambar powder', 'Sambar Powder', 'spices', 100, 'g', ['sambar masala', 'sambhar masala'], { emoji: '🟤' }],
  ['rasam powder', 'Rasam Powder', 'spices', 100, 'g', ['rasam masala'], { emoji: '🟤' }],
  ['biryani masala', 'Biryani Masala', 'spices', 50, 'g', [], { emoji: '🟤' }],
  ['chicken masala', 'Chicken Masala', 'spices', 100, 'g', ['meat masala'], { emoji: '🟤' }],
  ['kitchen king', 'Kitchen King Masala', 'spices', 100, 'g', ['kitchen king masala', 'sabzi masala'], { emoji: '🟤' }],
  ['kasuri methi', 'Kasuri Methi', 'spices', 25, 'g', ['kasoori methi', 'dried fenugreek leaves'], { emoji: '🌿' }],
  ['hing', 'Hing', 'spices', 50, 'g', ['asafoetida', 'heeng', 'perungayam', 'ingu'], { emoji: '🟤' }],
  ['black pepper', 'Black Pepper', 'spices', 50, 'g', ['kali mirch', 'kalimirch', 'pepper', 'milagu', 'menasu'], { emoji: '⚫' }],
  ['cloves', 'Cloves', 'spices', 50, 'g', ['laung', 'lavang', 'clove', 'krambu'], { emoji: '🟤' }],
  ['cardamom', 'Cardamom', 'spices', 50, 'g', ['elaichi', 'ilaichi', 'green cardamom', 'elakki', 'yelakki'], { emoji: '🟢' }],
  ['cinnamon', 'Cinnamon', 'spices', 50, 'g', ['dalchini', 'dal chini', 'pattai'], { emoji: '🟤' }],
  ['bay leaf', 'Bay Leaf', 'spices', 25, 'g', ['tej patta', 'tejpatta', 'bay leaves', 'biryani leaf'], { emoji: '🍃' }],
  ['fennel', 'Saunf', 'spices', 100, 'g', ['saunf', 'sonf', 'fennel seeds', 'badi saunf', 'sombu'], { search: 'saunf', emoji: '🌿' }],
  ['ajwain', 'Ajwain', 'spices', 50, 'g', ['carom seeds', 'ajowan', 'omam'], { emoji: '🌿' }],
  ['methi seeds', 'Methi Seeds', 'spices', 100, 'g', ['methi dana', 'fenugreek seeds', 'vendhayam', 'menthya'], { emoji: '🟤' }],
  ['dry red chilli', 'Dry Red Chilli', 'spices', 100, 'g', ['sabut lal mirch', 'whole red chilli', 'byadgi chilli', 'guntur chilli'], { emoji: '🌶️' }],
  ['sesame seeds', 'Sesame Seeds', 'spices', 100, 'g', ['til', 'white til', 'ellu'], { emoji: '⚪' }],
  ['kalonji', 'Kalonji', 'spices', 50, 'g', ['nigella seeds', 'onion seeds'], { emoji: '⚫' }],
  ['amchur', 'Amchur', 'spices', 100, 'g', ['amchoor', 'dry mango powder', 'aamchur'], { emoji: '🟡' }],
  ['saffron', 'Saffron', 'spices', 1, 'g', ['kesar', 'zafran'], { emoji: '🟠' }],
  ['tamarind', 'Tamarind', 'spices', 200, 'g', ['imli', 'puli', 'hunase', 'chintapandu'], { emoji: '🟤' }],
  ['ginger garlic paste', 'Ginger Garlic Paste', 'condiments', 200, 'g', ['adrak lehsun paste', 'gg paste'], { emoji: '🫙' }],

  // --- dry fruits & nuts --------------------------------------------------------
  ['almonds', 'Almonds', 'dry-fruits', 250, 'g', ['badam', 'almond', 'california almonds'], { emoji: '🌰' }],
  ['cashews', 'Cashews', 'dry-fruits', 250, 'g', ['kaju', 'cashew', 'cashew nuts', 'godambi'], { emoji: '🥜' }],
  ['raisins', 'Raisins', 'dry-fruits', 250, 'g', ['kishmish', 'kismis', 'raisin', 'dry grapes', 'manuka'], { emoji: '🍇' }],
  ['walnuts', 'Walnuts', 'dry-fruits', 250, 'g', ['akhrot', 'walnut', 'walnut kernels'], { emoji: '🌰' }],
  ['pistachios', 'Pistachios', 'dry-fruits', 200, 'g', ['pista', 'pistachio'], { emoji: '🥜' }],
  ['dates', 'Dates', 'dry-fruits', 500, 'g', ['khajoor', 'khajur', 'kharik', 'seedless dates'], { emoji: '🟤' }],
  ['peanuts', 'Peanuts', 'dry-fruits', 500, 'g', ['moongphali', 'mungfali', 'groundnut', 'groundnuts', 'shengdana', 'kadalai', 'kadlekai', 'singdana'], { emoji: '🥜' }],
  ['makhana', 'Makhana', 'dry-fruits', 100, 'g', ['fox nuts', 'lotus seeds', 'phool makhana'], { emoji: '⚪' }],
  ['figs', 'Anjeer', 'dry-fruits', 200, 'g', ['anjeer', 'anjir', 'dried figs', 'fig'], { emoji: '🟤' }],
  ['chia seeds', 'Chia Seeds', 'dry-fruits', 200, 'g', ['chia'], { emoji: '⚫' }],
  ['flax seeds', 'Flax Seeds', 'dry-fruits', 200, 'g', ['alsi', 'flaxseeds', 'linseed'], { emoji: '🟤' }],
  ['pumpkin seeds', 'Pumpkin Seeds', 'dry-fruits', 200, 'g', [], { emoji: '🟢' }],
  ['dry coconut', 'Dry Coconut', 'dry-fruits', 250, 'g', ['copra', 'kopra', 'sukha nariyal', 'desiccated coconut', 'coconut powder'], { emoji: '🥥' }],

  // --- snacks & sweets -----------------------------------------------------------
  ['biscuits', 'Biscuits', 'snacks', 1, 'pack', ['biscuit', 'cookies', 'cookie', 'marie', 'good day', 'parle g', 'bourbon', 'oreo', 'hide and seek', 'digestive'], { emoji: '🍪' }],
  ['chips', 'Chips', 'snacks', 1, 'pack', ['wafers', 'potato chips', 'lays', 'kurkure', 'banana chips', 'nachos'], { emoji: '🥔' }],
  ['namkeen', 'Namkeen', 'snacks', 1, 'pack', ['bhujia', 'mixture', 'chivda', 'farsan', 'aloo bhujia', 'moong dal namkeen', 'sev', 'murukku', 'chakli', 'chakri', 'khakhra', 'mathri', 'bhakarwadi', 'namak para', 'nippattu', 'papdi', 'thattai'], { emoji: '🥨' }],
  ['chocolate', 'Chocolate', 'snacks', 1, 'pack', ['chocolates', 'kitkat', 'choco bar', 'dark chocolate'], { emoji: '🍫' }],
  ['ice cream', 'Ice Cream', 'snacks', 1, 'pack', ['icecream', 'kulfi', 'ice cream tub', 'ice-cream'], { emoji: '🍨' }],
  ['popcorn', 'Popcorn', 'snacks', 1, 'pack', ['pop corn'], { emoji: '🍿' }],
  ['sweets', 'Sweets', 'snacks', 500, 'g', ['mithai', 'gulab jamun', 'rasgulla', 'soan papdi', 'laddoo', 'ladoo'], { emoji: '🍬' }],

  // --- beverages -----------------------------------------------------------------
  ['juice', 'Juice', 'beverages', 1, 'L', ['fruit juice', 'orange juice', 'apple juice', 'mixed fruit juice'], { density: 1.0, emoji: '🧃' }],
  ['mango drink', 'Mango Drink', 'beverages', 1, 'L', ['maaza', 'frooti', 'mango juice'], { density: 1.0, emoji: '🥭' }],
  ['soft drink', 'Soft Drink', 'beverages', 1, 'L', ['cold drink', 'coke', 'pepsi', 'thums up', 'thumbs up', 'sprite', 'fanta', 'limca', '7up', 'mountain dew', 'coca cola', 'soda'], { density: 1.0, emoji: '🥤' }],
  ['water', 'Packaged Water', 'beverages', 1, 'L', ['mineral water', 'drinking water', 'bisleri', 'kinley', 'aquafina', 'water bottle'], { density: 1.0, emoji: '💧' }],
  ['coconut water', 'Coconut Water', 'beverages', 200, 'ml', ['nariyal pani'], { density: 1.0, emoji: '🥥' }],
  ['health drink', 'Health Drink', 'beverages', 500, 'g', ['horlicks', 'bournvita', 'complan', 'protinex', 'pediasure', 'malt drink'], { emoji: '🥛' }],
  ['energy drink', 'Energy Drink', 'beverages', 250, 'ml', ['red bull', 'monster', 'sting'], { density: 1.0, emoji: '⚡' }],

  // --- condiments & instant ---------------------------------------------------------
  ['ketchup', 'Tomato Ketchup', 'condiments', 500, 'g', ['tomato ketchup', 'tomato sauce', 'sauce'], { density: 1.1, emoji: '🍅' }],
  ['mayonnaise', 'Mayonnaise', 'condiments', 250, 'g', ['mayo', 'eggless mayonnaise', 'veg mayonnaise'], { emoji: '🫙' }],
  ['pickle', 'Pickle', 'condiments', 400, 'g', ['achar', 'achaar', 'oorugai', 'uppinakayi', 'mango pickle', 'lime pickle'], { emoji: '🫙' }],
  ['vinegar', 'Vinegar', 'condiments', 500, 'ml', ['sirka', 'synthetic vinegar', 'apple cider vinegar'], { density: 1.0, emoji: '🫙' }],
  ['soy sauce', 'Soy Sauce', 'condiments', 200, 'g', ['soya sauce', 'dark soy sauce'], { density: 1.1, emoji: '🫙' }],
  ['coconut milk', 'Coconut Milk', 'condiments', 200, 'ml', ['coconut cream'], { density: 1.0, emoji: '🥥' }],
  ['noodles', 'Instant Noodles', 'instant', 1, 'pack', ['instant noodles', 'maggi', 'yippee', 'hakka noodles', 'noodle', 'ramen'], { emoji: '🍜' }],
  ['pasta', 'Pasta', 'instant', 500, 'g', ['macaroni', 'penne', 'spaghetti', 'fusilli'], { emoji: '🍝' }],
  ['soup', 'Instant Soup', 'instant', 1, 'pack', ['soup mix', 'instant soup'], { emoji: '🍲' }],
  ['ready to eat', 'Ready to Eat', 'instant', 1, 'pack', ['ready meal', 'rte', 'ready to cook'], { emoji: '🍛' }],

  // --- meat & fish ----------------------------------------------------------------------
  ['chicken', 'Chicken', 'meat', 500, 'g', ['murga', 'murgi', 'chicken curry cut', 'chicken breast', 'kozhi', 'koli'], { emoji: '🍗' }],
  ['mutton', 'Mutton', 'meat', 500, 'g', ['goat meat', 'gosht', 'lamb', 'mutton curry cut'], { emoji: '🍖' }],
  ['fish', 'Fish', 'meat', 500, 'g', ['machli', 'machhi', 'meen', 'rohu', 'pomfret', 'surmai', 'basa'], { emoji: '🐟' }],
  ['prawns', 'Prawns', 'meat', 250, 'g', ['jhinga', 'shrimp', 'prawn', 'eral'], { emoji: '🦐' }],

  // --- household ------------------------------------------------------------------------
  ['detergent', 'Detergent Powder', 'household', 1, 'kg', ['washing powder', 'detergent powder', 'surf', 'kapde dhone ka powder', 'surf excel', 'ariel', 'tide', 'rin', 'wheel', 'ghari', 'nirma'], { emoji: '🧺' }],
  ['liquid detergent', 'Liquid Detergent', 'household', 1, 'L', ['detergent liquid', 'washing liquid', 'matic liquid'], { density: 1.0, emoji: '🧴' }],
  ['detergent bar', 'Detergent Bar', 'household', 1, 'pack', ['washing bar', 'washing soap', 'rin bar', 'kapde ka sabun'], { emoji: '🧼' }],
  ['dishwash bar', 'Dishwash Bar', 'household', 1, 'pack', ['utensil bar', 'bartan bar', 'vim bar', 'dish bar', 'bartan sabun'], { emoji: '🧽' }],
  ['dishwash liquid', 'Dishwash Liquid', 'household', 500, 'ml', ['dish wash liquid', 'dishwash gel', 'vim liquid', 'pril', 'dish soap'], { density: 1.0, emoji: '🧴' }],
  ['floor cleaner', 'Floor Cleaner', 'household', 1, 'L', ['lizol', 'phenyl', 'phenyle', 'floor cleaning liquid'], { density: 1.0, emoji: '🧴' }],
  ['toilet cleaner', 'Toilet Cleaner', 'household', 500, 'ml', ['harpic', 'domex', 'bathroom cleaner'], { density: 1.0, emoji: '🚽' }],
  ['glass cleaner', 'Glass Cleaner', 'household', 500, 'ml', ['colin', 'window cleaner'], { density: 1.0, emoji: '🪟' }],
  ['garbage bags', 'Garbage Bags', 'household', 1, 'pack', ['dustbin bags', 'trash bags', 'garbage bag', 'bin bags'], { emoji: '🗑️' }],
  ['tissue', 'Tissue Paper', 'household', 1, 'pack', ['tissues', 'tissue paper', 'napkins', 'facial tissue'], { emoji: '🧻' }],
  ['toilet paper', 'Toilet Paper', 'household', 1, 'pack', ['toilet roll', 'toilet tissue'], { emoji: '🧻' }],
  ['aluminium foil', 'Aluminium Foil', 'household', 1, 'pack', ['foil', 'aluminum foil', 'silver foil'], { emoji: '🪙' }],
  ['matchbox', 'Matchbox', 'household', 1, 'pack', ['maachis', 'matches', 'match box'], { emoji: '🔥' }],
  ['agarbatti', 'Agarbatti', 'household', 1, 'pack', ['incense sticks', 'dhoop', 'agarbathi'], { emoji: '🪔' }],
  ['mosquito repellent', 'Mosquito Repellent', 'household', 1, 'pack', ['good knight', 'all out', 'mortein', 'odomos', 'mosquito coil', 'repellent refill'], { emoji: '🦟' }],
  ['scrub pad', 'Scrub Pad', 'household', 1, 'pack', ['scrubber', 'scotch brite', 'steel wool', 'sponge wipe'], { emoji: '🧽' }],

  // --- personal care ----------------------------------------------------------------------
  ['soap', 'Bathing Soap', 'personal', 4, 'pcs', ['bath soap', 'bathing soap', 'sabun', 'body soap', 'soap bar'], { discrete: true, emoji: '🧼' }],
  ['shampoo', 'Shampoo', 'personal', 340, 'ml', ['anti dandruff shampoo'], { density: 1.0, emoji: '🧴' }],
  ['conditioner', 'Conditioner', 'personal', 180, 'ml', ['hair conditioner'], { density: 1.0, emoji: '🧴' }],
  ['toothpaste', 'Toothpaste', 'personal', 150, 'g', ['tooth paste', 'colgate', 'pepsodent', 'close up', 'sensodyne', 'dant kanti'], { emoji: '🪥' }],
  ['toothbrush', 'Toothbrush', 'personal', 1, 'pcs', ['tooth brush', 'brush'], { discrete: true, emoji: '🪥' }],
  ['hair oil', 'Hair Oil', 'personal', 200, 'ml', ['almond hair oil', 'amla hair oil', 'parachute', 'bajaj almond drops'], { density: 0.91, emoji: '💆' }],
  ['face wash', 'Face Wash', 'personal', 100, 'g', ['facewash', 'face cleanser'], { density: 1.0, emoji: '🧴' }],
  ['body lotion', 'Body Lotion', 'personal', 200, 'ml', ['moisturiser', 'moisturizer', 'lotion'], { density: 1.0, emoji: '🧴' }],
  ['handwash', 'Handwash', 'personal', 250, 'ml', ['hand wash', 'liquid handwash', 'handwash refill'], { density: 1.0, emoji: '🧴' }],
  ['sanitizer', 'Hand Sanitizer', 'personal', 100, 'ml', ['hand sanitizer', 'sanitiser'], { density: 1.0, emoji: '🧴' }],
  ['deodorant', 'Deodorant', 'personal', 150, 'ml', ['deo', 'body spray', 'perfume spray'], { density: 1.0, emoji: '🌬️' }],
  ['sanitary pads', 'Sanitary Pads', 'personal', 1, 'pack', ['pads', 'whisper', 'stayfree', 'sofy', 'napkin pads'], { emoji: '🩷' }],
  ['razor', 'Razor', 'personal', 1, 'pack', ['shaving razor', 'blades', 'gillette'], { emoji: '🪒' }],
  ['diapers', 'Diapers', 'baby', 1, 'pack', ['diaper', 'pampers', 'huggies', 'mamypoko', 'baby pants'], { emoji: '👶' }],
  ['baby food', 'Baby Food', 'baby', 300, 'g', ['cerelac', 'baby cereal'], { emoji: '👶' }],
  ['baby wipes', 'Baby Wipes', 'baby', 1, 'pack', ['wet wipes', 'wipes'], { emoji: '👶' }],
  ['dog food', 'Dog Food', 'pet', 1, 'kg', ['pedigree', 'drools', 'dog biscuits'], { emoji: '🐶' }],
  ['cat food', 'Cat Food', 'pet', 1, 'kg', ['whiskas', 'me o'], { emoji: '🐱' }],
];

export const ITEMS: DictItem[] = RAW.map(([key, name, category, amount, unit, aliases, extra = {}]) => ({
  key,
  name,
  category,
  amount,
  unit,
  aliases,
  search: extra.search ?? key,
  parent: extra.parent ?? null,
  density: extra.density ?? null,
  discrete: extra.discrete ?? false,
  emoji: extra.emoji ?? '🛒',
}));

export const ITEM_BY_KEY: Record<string, DictItem> = Object.fromEntries(ITEMS.map((i) => [i.key, i]));

/** True when `child` is `ancestor` or one of its descendants. */
export function isKindOf(child: string, ancestor: string): boolean {
  let k: string | null = child;
  for (let guard = 0; k && guard < 8; guard++) {
    if (k === ancestor) return true;
    k = ITEM_BY_KEY[k]?.parent ?? null;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

export interface Brand {
  name: string;
  forms: string[];
  /** A row that is only the brand ("maggi") means this item. */
  implies: string | null;
}

type RawBrand = [name: string, forms?: string[], implies?: string];

/*
 * Single-word brands that are also everyday words (Slice, Real, Catch, Boost,
 * Wheel, Engine, Society) are deliberately absent: "cheese slice" must not
 * lock a row to a mango drink. Typing them still works — they become required
 * words and are matched in the listing title.
 */
const RAW_BRANDS: RawBrand[] = [
  ['Aashirvaad', ['ashirvad', 'ashirwad', 'aashirwad']],
  ['Fortune'],
  ['Tata Sampann', ['tata sampan']],
  ['Tata Tea', [], 'tea'],
  ['Tata Salt', [], 'salt'],
  ['Tata'],
  ['Amul'],
  ['Mother Dairy'],
  ['Nandini'],
  ['Heritage'],
  ['Akshayakalpa'],
  ['Milky Mist'],
  ['Gowardhan'],
  ['Britannia'],
  ['Parle'],
  ['Sunfeast'],
  ["Haldiram's", ['haldiram', 'haldirams']],
  ['Bikaji'],
  ['Balaji'],
  ["Lay's", ['lays'], 'chips'],
  ['Kurkure', [], 'chips'],
  ['Bingo'],
  ['Maggi', [], 'noodles'],
  ['Yippee', [], 'noodles'],
  ['Knorr'],
  ['Nestle'],
  ['Cadbury'],
  ['Kissan'],
  ['MTR'],
  ['MDH'],
  ['Everest'],
  ['Aachi'],
  ['Sakthi'],
  ['Badshah'],
  ['Saffola'],
  ['Sundrop'],
  ['Dhara'],
  ['Gemini'],
  ['Gold Winner'],
  ['Patanjali'],
  ['Dabur'],
  ['Emami'],
  ['Figaro'],
  ['Borges'],
  ['Del Monte'],
  ["Kellogg's", ['kelloggs', 'kellogs']],
  ['Quaker'],
  ["Bagrry's", ['bagrrys', 'bagrys']],
  ['True Elements'],
  ['Yoga Bar', ['yogabar']],
  ['Pintola'],
  ['Nutella', [], 'chocolate spread'],
  ["Hershey's", ['hersheys']],
  ['Daawat', ['dawat']],
  ['India Gate'],
  ['Kohinoor'],
  ['Lal Qilla'],
  ['24 Mantra', ['24 mantra organic']],
  ['Pro Nature'],
  ['Organic India'],
  ['Rajdhani'],
  ['Shakti Bhog'],
  ['Pillsbury'],
  ['Annapurna'],
  ['Nature Fresh'],
  ['Madhur'],
  ['Red Label', ['brooke bond red label'], 'tea'],
  ['Taj Mahal', [], 'tea'],
  ['Wagh Bakri', [], 'tea'],
  ['Lipton'],
  ['Tetley'],
  ['Nescafe', [], 'coffee'],
  ['Bru', [], 'coffee'],
  ['Coca-Cola', ['coca cola', 'coke'], 'soft drink'],
  ['Pepsi', [], 'soft drink'],
  ['Thums Up', ['thumbs up'], 'soft drink'],
  ['Sprite', [], 'soft drink'],
  ['Maaza', [], 'mango drink'],
  ['Frooti', [], 'mango drink'],
  ['Tropicana'],
  ['B Natural'],
  ['Paper Boat'],
  ['Bisleri', [], 'water'],
  ['Kinley', [], 'water'],
  ['Horlicks', [], 'health drink'],
  ['Bournvita', ['cadbury bournvita'], 'health drink'],
  ['Complan', [], 'health drink'],
  ['Veeba'],
  ['Funfoods', ['fun foods'], 'mayonnaise'],
  ["Ching's", ['chings']],
  ["Mother's Recipe", ['mothers recipe']],
  ['Priya'],
  ["Nilon's", ['nilons']],
  ['Lijjat'],
  ['Surf Excel', [], 'detergent'],
  ['Ariel', [], 'detergent'],
  ['Tide', [], 'detergent'],
  ['Rin'],
  ['Ghari', [], 'detergent'],
  ['Nirma'],
  ['Vim'],
  ['Pril', [], 'dishwash liquid'],
  ['Exo', [], 'dishwash bar'],
  ['Lizol', [], 'floor cleaner'],
  ['Harpic', [], 'toilet cleaner'],
  ['Domex', [], 'toilet cleaner'],
  ['Colin', [], 'glass cleaner'],
  ['Dettol'],
  ['Savlon'],
  ['Lifebuoy'],
  ['Lux'],
  ['Dove'],
  ['Pears'],
  ['Santoor'],
  ['Cinthol'],
  ['Hamam'],
  ['Medimix'],
  ['Godrej'],
  ['Colgate', [], 'toothpaste'],
  ['Pepsodent', [], 'toothpaste'],
  ['Close Up', ['closeup'], 'toothpaste'],
  ['Sensodyne', [], 'toothpaste'],
  ['Himalaya'],
  ['Head & Shoulders', ['head and shoulders'], 'shampoo'],
  ['Clinic Plus'],
  ['Pantene'],
  ['Sunsilk'],
  ['TRESemme', ['tresemme']],
  ['Parachute', [], 'coconut oil'],
  ['Nivea'],
  ["Pond's", ['ponds']],
  ['Vaseline'],
  ['Whisper', [], 'sanitary pads'],
  ['Stayfree', ['stay free'], 'sanitary pads'],
  ['Pampers', [], 'diapers'],
  ['Huggies', [], 'diapers'],
  ['MamyPoko', ['mamy poko'], 'diapers'],
  ['Cerelac', [], 'baby food'],
  ['Pedigree', [], 'dog food'],
  ['Whiskas', [], 'cat food'],
  ['Good Knight', ['goodknight'], 'mosquito repellent'],
  ['All Out', ['allout'], 'mosquito repellent'],
  ['Mortein', [], 'mosquito repellent'],
  ['Scotch-Brite', ['scotch brite'], 'scrub pad'],
  ['Fresho'],
  ['Happilo'],
  ['Nutraj'],
  ['Farmley'],
  ['Cornitos'],
  ['Pringles', [], 'chips'],
  ['Oreo', [], 'biscuits'],
  ['Unibic'],
  ["McVitie's", ['mcvities']],
  ['Too Yumm', ['too yum']],
  ['Epigamia'],
  ['Go Cheese', ['gocheese']],
  ['Kwality Walls', ["kwality wall's", 'kwality walls'], 'ice cream'],
  ['Baskin Robbins'],
  ['Havmor'],
  ['Vadilal'],
  ['iD Fresh', ['id fresh']],
  ['Licious'],
  ['FreshToHome', ['fresh to home']],
  ['Country Delight'],
  ['Akshaya'],
  ['Keya'],
  ['Catch Spices', ['catch']],
  ['Eastern Masala', ['eastern']],
  ['Freedom Oil', ['freedom']],
  ['Engine Tea', ['engine']],
];

export const BRANDS: Brand[] = RAW_BRANDS.map(([name, forms = [], implies]) => ({
  name,
  forms: [name, ...forms],
  implies: implies ?? null,
}));

// ---------------------------------------------------------------------------
// Phrase index (phonetic token sequences), longest first
// ---------------------------------------------------------------------------

interface Phrase<T> {
  tokens: string[];
  value: T;
  form: string;
}

function buildIndex<T>(entries: { forms: string[]; value: T }[]): Phrase<T>[] {
  const out: Phrase<T>[] = [];
  for (const e of entries) {
    for (const form of e.forms) {
      const tokens = tokenize(form).map(phonetic);
      if (tokens.length) out.push({ tokens, value: e.value, form });
    }
  }
  return out.sort((a, b) => b.tokens.length - a.tokens.length);
}

const ITEM_INDEX = buildIndex(ITEMS.map((i) => ({ forms: [i.key, i.name, ...i.aliases], value: i })));
const BRAND_INDEX = buildIndex(BRANDS.map((b) => ({ forms: b.forms, value: b })));

export interface PhraseHit<T> {
  value: T;
  start: number;
  end: number;
  form: string;
}

/** True when a and b differ by at most one edit or one adjacent swap ("penaut" / "peanut"). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    const diffs: number[] = [];
    for (let i = 0; i < la; i++) if (a[i] !== b[i]) diffs.push(i);
    if (diffs.length === 1) return true;
    return diffs.length === 2 && diffs[1] === diffs[0]! + 1 && a[diffs[0]!] === b[diffs[1]!] && a[diffs[1]!] === b[diffs[0]!];
  }
  const [s, l] = la < lb ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) {
      i++;
      j++;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      j++;
    }
  }
  return true;
}

/** Multi-word phrases indexed by each of their tokens, for the typo-tolerant pass. */
function tokenIndex<T>(index: Phrase<T>[]): Map<string, { p: Phrase<T>; j: number }[]> {
  const m = new Map<string, { p: Phrase<T>; j: number }[]>();
  for (const p of index) {
    if (p.tokens.length < 2) continue;
    p.tokens.forEach((t, j) => m.set(t, [...(m.get(t) ?? []), { p, j }]));
  }
  return m;
}

const FUZZY_MIN_LENGTH = 5;
const tokenIndexCache = new WeakMap<object, Map<string, { p: Phrase<unknown>; j: number }[]>>();

function allHits<T>(index: Phrase<T>[], tokens: string[]): PhraseHit<T>[] {
  const hits: PhraseHit<T>[] = [];
  const seen = new Set<string>();
  for (const p of index) {
    let from = 0;
    for (;;) {
      const at = findSequence(tokens, p.tokens, from);
      if (at < 0) break;
      hits.push({ value: p.value, start: at, end: at + p.tokens.length, form: p.form });
      seen.add(`${p.form}@${at}`);
      from = at + 1;
    }
  }

  // Typo-tolerant pass for multi-word phrases: one word may be off by a single
  // edit or swap, as long as another word matches exactly — so "Penaut Butter"
  // is still peanut butter, while "Better" alone never becomes butter.
  let byToken = tokenIndexCache.get(index) as Map<string, { p: Phrase<T>; j: number }[]> | undefined;
  if (!byToken) {
    byToken = tokenIndex(index);
    tokenIndexCache.set(index, byToken as Map<string, { p: Phrase<unknown>; j: number }[]>);
  }
  tokens.forEach((tok, k) => {
    for (const { p, j } of byToken!.get(tok) ?? []) {
      const start = k - j;
      const end = start + p.tokens.length;
      if (start < 0 || end > tokens.length || seen.has(`${p.form}@${start}`)) continue;
      let misses = 0;
      let ok = true;
      for (let t = 0; t < p.tokens.length; t++) {
        const want = p.tokens[t]!;
        const got = tokens[start + t]!;
        if (want === got) continue;
        misses++;
        if (misses > 1 || want.length < FUZZY_MIN_LENGTH || got.length < FUZZY_MIN_LENGTH || !withinOneEdit(want, got)) {
          ok = false;
          break;
        }
      }
      if (ok && misses === 1) {
        seen.add(`${p.form}@${start}`);
        hits.push({ value: p.value, start, end, form: p.form });
      }
    }
  });
  return hits;
}

/**
 * The product type named by a token list: of every dictionary phrase present,
 * the one that ENDS last (the head noun comes last in "milk chocolate"), and
 * of those the longest ("butter milk" beats "milk").
 */
export function findItem(phoneticTokens: string[]): PhraseHit<DictItem> | null {
  const hits = allHits(ITEM_INDEX, phoneticTokens);
  if (!hits.length) return null;
  hits.sort((a, b) => b.end - a.end || b.end - b.start - (a.end - a.start));
  return hits[0]!;
}

/** The longest brand phrase present, if any. */
export function findBrand(phoneticTokens: string[]): PhraseHit<Brand> | null {
  const hits = allHits(BRAND_INDEX, phoneticTokens);
  if (!hits.length) return null;
  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  return hits[0]!;
}

export function brandByName(name: string): Brand | null {
  const tokens = tokenize(name).map(phonetic);
  const hit = findBrand(tokens);
  return hit && hit.start === 0 && hit.end === tokens.length ? hit.value : null;
}

/** Every alias of an item, used to recognise it inside listing titles. */
export function itemForms(item: DictItem): string[] {
  return [...new Set([item.key, item.name.toLowerCase(), ...item.aliases])];
}
