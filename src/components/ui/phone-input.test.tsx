import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import { PhoneInput } from "./phone-input";

function Harness({ initial = "", saved }: { initial?: string; saved: string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <PhoneInput
        id="phone"
        aria-label="Phone"
        country="CZ"
        value={value}
        onChange={(next) => {
          saved.push(next);
          setValue(next);
        }}
      />
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

const input = () => screen.getByLabelText("Phone") as HTMLInputElement;

describe("PhoneInput", () => {
  it("starts with the country prefix and saves E.164 while grouping the digits", () => {
    const saved: string[] = [];
    render(<Harness saved={saved} />);
    fireEvent.focus(input());
    expect(input().value).toBe("+420 ");
    fireEvent.change(input(), { target: { value: "+420 777123456" } });
    expect(input().value).toBe("+420 777 123 456");
    expect(saved.at(-1)).toBe("+420777123456");
  });

  it("re-reads a pasted number in any form", () => {
    const saved: string[] = [];
    render(<Harness saved={saved} />);
    fireEvent.focus(input());
    fireEvent.paste(input(), { clipboardData: { getData: () => "00421-905-111-222" } });
    expect(input().value).toBe("+421 905 111 222");
    expect(saved.at(-1)).toBe("+421905111222");
  });

  it("drops a lone prefix on blur and warns softly about an invalid number", () => {
    const saved: string[] = [];
    render(<Harness saved={saved} />);
    fireEvent.focus(input());
    fireEvent.blur(input());
    expect(input().value).toBe("");
    expect(saved).toEqual([]);

    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "+420 123 45" } });
    fireEvent.blur(input());
    expect(screen.getByText(en.phone.invalid)).toBeTruthy();
    // Saving is not blocked: the text is handed over as it is.
    expect(saved.at(-1)).toBe(input().value);
    expect(input().value).toBe("+420 12345");
  });

  it("shows a saved number with its prefix", () => {
    render(<Harness initial="+420777123456" saved={[]} />);
    expect(input().value).toBe("+420 777 123 456");
  });
});
