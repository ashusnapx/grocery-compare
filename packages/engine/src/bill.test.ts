import { describe, expect, it } from 'vitest';
import { billToOverride, parseBillText } from './bill';

const BLINKIT = `Bill details
Items total ₹245
Delivery charge ₹30
Handling charge ₹5
Small cart charge ₹20
Grand total ₹300
Add items worth ₹54 more to get FREE delivery`;

const ZEPTO_FREE = `Bill Summary
Item Total ₹412
Handling Fee ₹12.99
Delivery Fee ₹30 FREE
To Pay ₹424.99`;

const INSTAMART_OCR = `Bill Details
Item Total %186
Delivery Fee | 2.1 kms Rs 30
Handling Fee Rs. 9.80
Late Night Fee ₹ 10
To Pay 235.80
Free delivery on orders above ₹199`;

describe('parseBillText', () => {
  it('reads a Blinkit bill, including the free-delivery gap', () => {
    const r = parseBillText(BLINKIT);
    expect(r).toMatchObject({ platformId: null, itemTotal: 245, deliveryFee: 30, handlingFee: 5, smallCartFee: 20, freeDeliveryAbove: 299 });
  });

  it('treats a struck-through delivery fee marked FREE as free', () => {
    const r = parseBillText(`Zepto\n${ZEPTO_FREE}`);
    expect(r).toMatchObject({ platformId: 'zepto', itemTotal: 412, deliveryFree: true, handlingFee: 12.99 });
    expect(r.deliveryFee).toBeUndefined();
  });

  it('copes with OCR mangling ₹ into % or Rs, and distances on the fee line', () => {
    const r = parseBillText(`Swiggy Instamart\n${INSTAMART_OCR}`);
    expect(r).toMatchObject({ platformId: 'instamart', itemTotal: 186, deliveryFee: 30, handlingFee: 9.8, lateNightFee: 10, freeDeliveryAbove: 199 });
  });

  it('reads a small-cart threshold stated on the line', () => {
    expect(parseBillText('Small cart fee (orders below ₹99) ₹15')).toMatchObject({ smallCartFee: 15, smallCartBelow: 99 });
  });

  it('undoes OCR reading ₹ as a leading 3, checked against the grand total (real tesseract output)', () => {
    const ocr =
      'blinkit\n\nBill details\n\nItems total 3245\nDelivery charge 325\nHandling charge 39\nSmall cart charge 320\nGrand total 299\nAdd items worth ¥104 more to get FREE delivery\n';
    expect(parseBillText(ocr)).toMatchObject({
      platformId: 'blinkit',
      itemTotal: 245,
      deliveryFee: 25,
      handlingFee: 9,
      smallCartFee: 20,
      freeDeliveryAbove: 349,
    });
  });

  it('keeps amounts that genuinely start with 3 when the total says they are right', () => {
    expect(parseBillText('Item Total 345\nDelivery Fee 30\nHandling Fee 5\nTo Pay 380')).toMatchObject({
      itemTotal: 345,
      deliveryFee: 30,
      handlingFee: 5,
    });
  });

  it('without a total, treats an implausible 3xx fee as a misread ₹', () => {
    expect(parseBillText('Delivery charge 325\nHandling charge 39')).toMatchObject({ deliveryFee: 25, handlingFee: 9 });
  });

  it('returns nothing it could not read', () => {
    expect(parseBillText('hello world')).toEqual({ platformId: null });
  });
});

describe('billToOverride', () => {
  it('turns a reading into the fee override the planner uses', () => {
    expect(billToOverride(parseBillText(BLINKIT), 'blinkit')).toEqual({
      platformId: 'blinkit',
      deliveryFee: 30,
      freeDeliveryAbove: 299,
      handlingFee: 5,
      smallCartFee: 20,
    });
  });

  it('keeps a free delivery as free without inventing a threshold', () => {
    expect(billToOverride(parseBillText(ZEPTO_FREE), 'zepto')).toEqual({ platformId: 'zepto', handlingFee: 12.99 });
  });
});

describe('parseBillText: packaging fees', () => {
  it('reads a packaging fee line as its own fee', () => {
    const r = parseBillText('Item total ₹1378\nDelivery fee ₹16\nPackaging fee ₹11\nGrand total ₹1405');
    expect(r).toMatchObject({ itemTotal: 1378, deliveryFee: 16, packagingFee: 11 });
  });
});
