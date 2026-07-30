Style reference examples, one folder per target language code.

How it's used:
- When you translate, the panel looks up a folder here matching the language
  code you typed in "Target language" (e.g. typing "German (de)" or just "de"
  uses the ./de folder).
- Every .txt file in that folder is read and given to the LLM as a reference
  example of your approved house style for that language — tone, sentence
  length, terminology, how warnings/steps are phrased.
- Add real, approved snippets from your own manuals here. Plain .txt files,
  one block of text per file (or one file with several blocks separated by
  blank lines — either works). No fixed naming convention required.
- Empty folder = no style reference is sent for that language, translation
  still runs using the default IEC/IEEE 82079 minimalist style instruction.

Folders already created: en, de, fr, cs, pl, nl — add more as needed, folder
name must match the language code you type in the panel.
