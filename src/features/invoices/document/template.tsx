import type { ReactNode } from "react";
import type { InvoiceStyle } from "../types";
import type { DocPair, DocParty, InvoiceDocument } from "./model";
import { FONT_SANS, FONT_SERIF, PRINT } from "./palette";
import type { DocStyle, Primitives } from "./primitives";

/**
 * The four looks of an invoice. Every one prints the same document (model.ts)
 * in the same order: header, the two parties, dates, items, payment with the
 * QR code next to the totals, VAT recapitulation, note, footer. Only the
 * typography, rules and fills differ:
 *
 * - clean:   typography and white space, hairlines only
 * - line:    a band of the accent colour across the top, accent headings and total
 * - block:   a dark header block with the supplier, the amount due in a dark block
 * - classic: serif, boxed parties and a fully ruled table for conservative customers
 */

const PAD = { top: 40, side: 44, bottom: 64 } as const;

type Look = {
  font: string;
  headFont: string;
  accent: string;
  /** Colour of section headings. */
  heading: string;
  ruled: boolean;
};

function lookFor(style: InvoiceStyle, accent: string): Look {
  switch (style) {
    case "line":
      return { font: FONT_SANS, headFont: FONT_SANS, accent, heading: accent, ruled: false };
    case "block":
      return { font: FONT_SANS, headFont: FONT_SANS, accent: PRINT.ink, heading: PRINT.muted, ruled: false };
    case "classic":
      return { font: FONT_SERIF, headFont: FONT_SERIF, accent: PRINT.ink, heading: PRINT.ink, ruled: true };
    default:
      return { font: FONT_SANS, headFont: FONT_SANS, accent: PRINT.ink, heading: PRINT.muted, ruled: false };
  }
}

const micro = (look: Look, color = look.heading): DocStyle => ({
  fontFamily: look.font,
  fontSize: 6.8,
  fontWeight: 600,
  letterSpacing: 0.9,
  textTransform: "uppercase",
  color,
  lineHeight: 1.3,
});

const body = (look: Look, color: string = PRINT.ink): DocStyle => ({
  fontFamily: look.font,
  fontSize: 8.8,
  lineHeight: 1.45,
  color,
});

const border = (side: "Top" | "Bottom" | "Left" | "Right", width: number, color: string): DocStyle => ({
  [`border${side}Width`]: width,
  [`border${side}Color`]: color,
  [`border${side}Style`]: "solid",
});

/** "IČO: 123", or the value alone when it needs no label ("Not registered for VAT"). */
const pairText = (pair: DocPair) => (pair.label ? `${pair.label}: ${pair.value}` : pair.value);

const box = (width: number, color: string): DocStyle => ({
  ...border("Top", width, color),
  ...border("Bottom", width, color),
  ...border("Left", width, color),
  ...border("Right", width, color),
});

export function InvoiceTemplate({ doc, P }: { doc: InvoiceDocument; P: Primitives }): ReactNode {
  const look = lookFor(doc.style, doc.accent);
  const { Page, View, Text } = P;

  return (
    <Page
      style={{
        backgroundColor: PRINT.paper,
        paddingTop: PAD.top,
        paddingBottom: PAD.bottom,
        paddingLeft: PAD.side,
        paddingRight: PAD.side,
        fontFamily: look.font,
        color: PRINT.ink,
      }}
    >
      {doc.style === "line" && (
        <View
          fixed
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, backgroundColor: doc.accent }}
        />
      )}

      <Header doc={doc} look={look} P={P} />

      <View style={{ flexDirection: "row", marginTop: doc.style === "block" ? 22 : 26 }}>
        {doc.style !== "block" && (
          <View style={{ width: "50%", paddingRight: 14 }}>
            <Party party={doc.supplier} look={look} P={P} boxed={look.ruled} />
          </View>
        )}
        <View style={{ width: "50%", paddingRight: doc.style === "block" ? 14 : 0, paddingLeft: doc.style === "block" ? 0 : 14 }}>
          <Party party={doc.customer} look={look} P={P} boxed={look.ruled} />
        </View>
        {doc.style === "block" && (
          <View style={{ width: "50%", paddingLeft: 14 }}>
            <Pairs pairs={doc.dates} look={look} P={P} />
          </View>
        )}
      </View>

      {doc.style !== "block" && <DatesRow doc={doc} look={look} P={P} />}

      {doc.creditFor && (
        <Text style={{ ...body(look, PRINT.soft), marginTop: 14 }}>{doc.creditFor}</Text>
      )}

      <Items doc={doc} look={look} P={P} />

      <View wrap={false} style={{ flexDirection: "row", marginTop: 18 }}>
        <View style={{ width: "55%", paddingRight: 18 }}>
          <Payment doc={doc} look={look} P={P} />
        </View>
        <View style={{ width: "45%" }}>
          <Totals doc={doc} look={look} P={P} />
        </View>
      </View>

      {doc.vatRecap && <VatRecap doc={doc} look={look} P={P} />}

      {doc.note && (
        <View wrap={false} style={{ marginTop: 18 }}>
          <Text style={micro(look)}>{doc.note.label}</Text>
          <Text style={{ ...body(look, PRINT.soft), marginTop: 4 }}>{doc.note.value}</Text>
        </View>
      )}

      <View
        fixed
        style={{
          position: "absolute",
          bottom: 26,
          left: PAD.side,
          right: PAD.side,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-end",
          paddingTop: 8,
          ...border("Top", look.ruled ? 0.8 : 0.6, look.ruled ? PRINT.ink : PRINT.hairline),
        }}
      >
        <Text style={{ ...body(look, PRINT.muted), fontSize: 7.4, width: "78%" }}>{doc.footer ?? ""}</Text>
        <Text
          fixed
          // A line height on a page-number text hides it in react-pdf; one line needs none.
          style={{ fontFamily: look.font, color: PRINT.muted, fontSize: 7.4, width: "22%", textAlign: "right" }}
          render={({ pageNumber, totalPages }) => doc.pageLabel(pageNumber, totalPages)}
        />
      </View>
    </Page>
  );
}

type BlockProps = { doc: InvoiceDocument; look: Look; P: Primitives };

function Header({ doc, look, P }: BlockProps) {
  const { View, Text } = P;

  if (doc.style === "block") {
    return (
      <View
        style={{
          marginTop: -PAD.top,
          marginLeft: -PAD.side,
          marginRight: -PAD.side,
          paddingTop: 34,
          paddingBottom: 26,
          paddingLeft: PAD.side,
          paddingRight: PAD.side,
          backgroundColor: PRINT.block,
          flexDirection: "row",
          justifyContent: "space-between",
        }}
      >
        <View style={{ width: "58%", paddingRight: 16 }}>
          <Text style={micro(look, PRINT.blockSoft)}>{doc.supplier.heading}</Text>
          <Text style={{ fontFamily: look.font, fontSize: 15, fontWeight: 600, color: PRINT.paper, marginTop: 5, lineHeight: 1.25 }}>
            {doc.supplier.name}
          </Text>
          {[...doc.supplier.lines, ...doc.supplier.contact].map((line, index) => (
            <Text key={`l${index}`} style={{ ...body(look, PRINT.blockSoft), marginTop: index === 0 ? 5 : 0 }}>
              {line}
            </Text>
          ))}
          {doc.supplier.ids.map((pair) => (
            <Text key={pair.label} style={body(look, PRINT.blockSoft)}>
              {pairText(pair)}
            </Text>
          ))}
        </View>
        <View style={{ width: "42%", alignItems: "flex-end" }}>
          <Text style={{ ...micro(look, PRINT.blockSoft), textAlign: "right" }}>{doc.title}</Text>
          <Text style={{ fontFamily: look.font, fontSize: 22, fontWeight: 600, color: PRINT.paper, marginTop: 6, textAlign: "right", lineHeight: 1.2 }}>
            {doc.number}
          </Text>
        </View>
      </View>
    );
  }

  if (doc.style === "classic") {
    return (
      <View style={{ alignItems: "center", paddingBottom: 14, ...border("Bottom", 1.2, PRINT.ink) }}>
        <Text style={{ fontFamily: look.headFont, fontSize: 15, fontWeight: 600, letterSpacing: 1.6, textTransform: "uppercase", textAlign: "center", lineHeight: 1.3 }}>
          {doc.title}
        </Text>
        <Text style={{ ...body(look, PRINT.soft), fontSize: 10, marginTop: 4, textAlign: "center" }}>
          {`${doc.numberLabel} ${doc.number}`}
        </Text>
      </View>
    );
  }

  // clean and line
  const line = doc.style === "line";
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-end",
        paddingTop: line ? 8 : 0,
        paddingBottom: 18,
        ...border("Bottom", 0.6, PRINT.hairline),
      }}
    >
      <View style={{ width: "55%", paddingRight: 16 }}>
        <Text style={{ fontFamily: look.font, fontSize: 15, fontWeight: 600, lineHeight: 1.25 }}>
          {doc.supplier.name}
        </Text>
      </View>
      <View style={{ width: "45%", alignItems: "flex-end" }}>
        <Text style={{ ...micro(look, line ? doc.accent : PRINT.muted), textAlign: "right" }}>{doc.title}</Text>
        <Text style={{ fontFamily: look.font, fontSize: 21, fontWeight: 600, color: line ? doc.accent : PRINT.ink, marginTop: 4, textAlign: "right", lineHeight: 1.2 }}>
          {doc.number}
        </Text>
      </View>
    </View>
  );
}

function Party({ party, look, P, boxed }: { party: DocParty; look: Look; P: Primitives; boxed: boolean }) {
  const { View, Text } = P;
  return (
    <View style={boxed ? { ...box(0.8, PRINT.ink), padding: 0 } : {}}>
      <Text
        style={{
          ...micro(look),
          ...(boxed
            ? { backgroundColor: PRINT.fill, paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8, ...border("Bottom", 0.8, PRINT.ink) }
            : {}),
        }}
      >
        {party.heading}
      </Text>
      <View style={boxed ? { paddingTop: 7, paddingBottom: 8, paddingLeft: 8, paddingRight: 8 } : { marginTop: 6 }}>
        <Text style={{ ...body(look), fontSize: 10, fontWeight: 600, lineHeight: 1.3 }}>{party.name}</Text>
        {party.lines.map((line, index) => (
          <Text key={`l${index}`} style={{ ...body(look, PRINT.soft), marginTop: index === 0 ? 3 : 0 }}>
            {line}
          </Text>
        ))}
        {party.ids.length > 0 && (
          <View style={{ marginTop: 5 }}>
            {party.ids.map((pair) => (
              <Text key={pair.label} style={body(look, PRINT.soft)}>
                {pairText(pair)}
              </Text>
            ))}
          </View>
        )}
        {party.contact.map((line, index) => (
          <Text key={`c${index}`} style={{ ...body(look, PRINT.muted), marginTop: index === 0 ? 5 : 0 }}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Pairs({ pairs, look, P }: { pairs: DocPair[]; look: Look; P: Primitives }) {
  const { View, Text } = P;
  return (
    <View>
      {pairs.map((pair, index) => (
        <View key={pair.label} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: index === 0 ? 0 : 5 }}>
          <Text style={body(look, PRINT.muted)}>{pair.label}</Text>
          <Text style={{ ...body(look), fontWeight: 600, textAlign: "right" }}>{pair.value}</Text>
        </View>
      ))}
    </View>
  );
}

function DatesRow({ doc, look, P }: BlockProps) {
  const { View, Text } = P;
  const cells = doc.dates;
  if (look.ruled) {
    return (
      <View style={{ flexDirection: "row", marginTop: 14, ...box(0.8, PRINT.ink) }}>
        {cells.map((pair, index) => (
          <View
            key={pair.label}
            style={{
              flexGrow: 1,
              flexBasis: 0,
              paddingTop: 5,
              paddingBottom: 6,
              paddingLeft: 8,
              paddingRight: 8,
              ...(index > 0 ? border("Left", 0.8, PRINT.ink) : {}),
            }}
          >
            <Text style={micro(look)}>{pair.label}</Text>
            <Text style={{ ...body(look), fontWeight: 600, marginTop: 2 }}>{pair.value}</Text>
          </View>
        ))}
      </View>
    );
  }
  return (
    <View
      style={{
        flexDirection: "row",
        marginTop: 22,
        paddingTop: 12,
        paddingBottom: 12,
        ...border("Top", 0.6, PRINT.hairline),
        ...border("Bottom", 0.6, PRINT.hairline),
      }}
    >
      {cells.map((pair) => (
        <View key={pair.label} style={{ flexGrow: 1, flexBasis: 0, paddingRight: 10 }}>
          <Text style={micro(look)}>{pair.label}</Text>
          <Text style={{ ...body(look), fontWeight: 600, marginTop: 3 }}>{pair.value}</Text>
        </View>
      ))}
    </View>
  );
}

function Items({ doc, look, P }: BlockProps) {
  const { View, Text } = P;
  const vat = doc.vatPayer;
  // Widths of the columns: item, quantity, unit price, VAT, total.
  const widths = vat ? ["40%", "13%", "17%", "10%", "20%"] : ["46%", "15%", "19%", "0%", "20%"];
  const ruled = look.ruled;
  const headerFill = doc.style === "block" || ruled;
  const cell = (index: number, extra: DocStyle = {}): DocStyle => ({
    width: widths[index],
    paddingTop: ruled ? 4 : 6,
    paddingBottom: ruled ? 4 : 6,
    paddingLeft: index === 0 && !ruled && !headerFill ? 0 : 6,
    paddingRight: index === 4 && !ruled && !headerFill ? 0 : 6,
    textAlign: index === 0 ? "left" : "right",
    ...(ruled && index > 0 ? border("Left", 0.6, PRINT.ink) : {}),
    ...extra,
  });
  const columns = [doc.columns.item, doc.columns.quantity, doc.columns.unitPrice, doc.columns.vatRate, doc.columns.total];

  return (
    <View style={{ marginTop: 22, ...(ruled ? box(0.8, PRINT.ink) : {}) }}>
      <View
        style={{
          flexDirection: "row",
          ...(headerFill ? { backgroundColor: PRINT.fill } : {}),
          ...(doc.style === "line"
            ? border("Bottom", 1.2, doc.accent)
            : border("Bottom", ruled ? 0.8 : 0.6, ruled ? PRINT.ink : PRINT.rule)),
        }}
      >
        {columns.map((label, index) =>
          !vat && index === 3 ? null : (
            <Text key={index} style={{ ...micro(look, doc.style === "line" ? doc.accent : look.heading), ...cell(index) }}>
              {label}
            </Text>
          ),
        )}
      </View>
      {doc.items.map((item, row) => (
        <View
          key={item.key}
          wrap={false}
          style={{
            flexDirection: "row",
            ...(row < doc.items.length - 1 || !ruled
              ? border("Bottom", ruled ? 0.6 : 0.6, ruled ? PRINT.ink : PRINT.hairline)
              : {}),
          }}
        >
          <Text style={{ ...body(look), ...cell(0) }}>{item.name}</Text>
          <Text style={{ ...body(look, PRINT.soft), ...cell(1) }}>{item.quantity}</Text>
          <Text style={{ ...body(look, PRINT.soft), ...cell(2) }}>{item.unitPrice}</Text>
          {vat && <Text style={{ ...body(look, PRINT.soft), ...cell(3) }}>{item.vatRate ?? ""}</Text>}
          <Text style={{ ...body(look), fontWeight: 600, ...cell(4) }}>{item.total}</Text>
        </View>
      ))}
      {doc.emptyItems && (
        <Text style={{ ...body(look, PRINT.muted), paddingTop: 10, paddingBottom: 10, paddingLeft: ruled ? 6 : 0 }}>
          {doc.emptyItems}
        </Text>
      )}
    </View>
  );
}

function Payment({ doc, look, P }: BlockProps) {
  const { View, Text, Svg, Path } = P;
  const ruled = look.ruled;
  const QR_SIZE = ruled ? 76 : 82;
  return (
    <View
      style={{
        flexDirection: "row",
        ...(ruled ? { ...box(0.8, PRINT.ink), paddingTop: 7, paddingBottom: 8, paddingLeft: 8, paddingRight: 8 } : {}),
      }}
    >
      <View style={{ flexGrow: 1, flexBasis: 0, paddingRight: doc.qr ? 12 : 0 }}>
        {doc.payment.map((pair, index) => (
          <View key={pair.label} style={{ marginTop: index === 0 ? 0 : 6 }}>
            <Text style={micro(look)}>{pair.label}</Text>
            <Text style={{ ...body(look), fontSize: 8.4, fontWeight: 600, marginTop: 1 }}>{pair.value}</Text>
          </View>
        ))}
      </View>
      {doc.qr && (
        <View style={{ width: QR_SIZE, alignItems: "center" }}>
          <Svg width={QR_SIZE} height={QR_SIZE} viewBox={`-2 -2 ${doc.qr.size + 4} ${doc.qr.size + 4}`}>
            <Path d={doc.qr.d} fill={PRINT.ink} />
          </Svg>
          <Text style={{ ...micro(look, PRINT.soft), marginTop: 4, textAlign: "center", letterSpacing: 0.6 }}>
            {doc.qr.caption}
          </Text>
        </View>
      )}
    </View>
  );
}

function Totals({ doc, look, P }: BlockProps) {
  const { View, Text } = P;
  const ruled = look.ruled;
  const block = doc.style === "block";
  const line = doc.style === "line";
  return (
    <View style={ruled ? box(0.8, PRINT.ink) : {}}>
      <View style={ruled ? { paddingTop: 7, paddingBottom: 4, paddingLeft: 8, paddingRight: 8 } : {}}>
        {doc.totals.map((pair, index) => (
          <View key={pair.label} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: index === 0 ? 0 : 5 }}>
            <Text style={body(look, PRINT.soft)}>{pair.label}</Text>
            <Text style={{ ...body(look), textAlign: "right" }}>{pair.value}</Text>
          </View>
        ))}
      </View>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: ruled ? 4 : 10,
          paddingTop: block ? 11 : 9,
          paddingBottom: block ? 11 : ruled ? 8 : 0,
          paddingLeft: block || ruled ? 10 : line ? 10 : 0,
          paddingRight: block || ruled ? 10 : 0,
          ...(block
            ? { backgroundColor: PRINT.block }
            : ruled
              ? { backgroundColor: PRINT.fill, ...border("Top", 0.8, PRINT.ink) }
              : line
                ? { ...border("Left", 3, doc.accent), ...border("Top", 0.6, PRINT.hairline) }
                : border("Top", 0.8, PRINT.ink)),
        }}
      >
        <Text style={{ ...body(look, block ? PRINT.blockSoft : PRINT.ink), fontWeight: 600, fontSize: 9.5 }}>
          {doc.due.label}
        </Text>
        <Text
          style={{
            fontFamily: look.font,
            fontSize: 16,
            fontWeight: 700,
            textAlign: "right",
            lineHeight: 1.2,
            color: block ? PRINT.paper : line ? doc.accent : PRINT.ink,
          }}
        >
          {doc.due.value}
        </Text>
      </View>
    </View>
  );
}

function VatRecap({ doc, look, P }: BlockProps) {
  const { View, Text } = P;
  const recap = doc.vatRecap;
  if (!recap) return null;
  const ruled = look.ruled;
  const cols = [recap.columns.rate, recap.columns.base, recap.columns.vat, recap.columns.total];
  const cell = (index: number): DocStyle => ({
    width: "25%",
    textAlign: index === 0 ? "left" : "right",
    paddingTop: 3,
    paddingBottom: 3,
    paddingLeft: ruled ? 6 : 0,
    paddingRight: ruled ? 6 : 0,
    ...(ruled && index > 0 ? border("Left", 0.6, PRINT.ink) : {}),
  });
  return (
    <View wrap={false} style={{ marginTop: 18, width: "55%", paddingRight: 18 }}>
      <Text style={{ ...micro(look), marginBottom: 4 }}>{recap.heading}</Text>
      <View style={ruled ? box(0.8, PRINT.ink) : {}}>
        <View style={{ flexDirection: "row", ...border("Bottom", ruled ? 0.8 : 0.6, ruled ? PRINT.ink : PRINT.hairline) }}>
          {cols.map((label, index) => (
            <Text key={index} style={{ ...body(look, PRINT.muted), fontSize: 7.6, ...cell(index) }}>
              {label}
            </Text>
          ))}
        </View>
        {recap.rows.map((row) => (
          <View key={row.rate} style={{ flexDirection: "row" }}>
            {[row.rate, row.base, row.vat, row.total].map((value, index) => (
              <Text key={index} style={{ ...body(look, PRINT.soft), fontSize: 8, ...cell(index) }}>
                {value}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}
