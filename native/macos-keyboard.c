#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct { char key; CGKeyCode code; } KeyMap;

static const KeyMap MAP[] = {
  {'a',0},{'s',1},{'d',2},{'f',3},{'h',4},{'g',5},{'z',6},{'x',7},
  {'c',8},{'v',9},{'b',11},{'q',12},{'w',13},{'e',14},{'r',15},
  {'y',16},{'t',17},{'1',18},{'2',19},{'3',20},{'4',21},{'6',22},
  {'5',23},{'=',24},{'9',25},{'7',26},{'-',27},{'8',28},{'0',29},
  {']',30},{'o',31},{'u',32},{'[',33},{'i',34},{'p',35},{'l',37},
  {'j',38},{'k',40},{';',41},{'\\',42},{',',43},{'/',44},{'n',45},
  {'m',46},{'.',47},{'`',50}
};
static const size_t MAP_COUNT = sizeof(MAP) / sizeof(MAP[0]);

static int code_for(char key, CGKeyCode *code) {
  for (size_t i = 0; i < MAP_COUNT; i++) {
    if (MAP[i].key == key) { *code = MAP[i].code; return 1; }
  }
  return 0;
}

static void post_key(char key, int down) {
  CGKeyCode code;
  if (!code_for(key, &code)) return;
  CGEventRef event = CGEventCreateKeyboardEvent(NULL, code, down);
  if (event) {
    CGEventPost(kCGHIDEventTap, event);
    CFRelease(event);
  }
}

static void release_all(void) {
  for (size_t i = 0; i < MAP_COUNT; i++) post_key(MAP[i].key, 0);
}

int main(int argc, char **argv) {
  if (argc > 1 && strcmp(argv[1], "--release") == 0) {
    release_all();
    return 0;
  }

  const void *promptKeys[] = { kAXTrustedCheckOptionPrompt };
  const void *promptValues[] = { kCFBooleanTrue };
  CFDictionaryRef options = CFDictionaryCreate(
    NULL, promptKeys, promptValues, 1,
    &kCFCopyStringDictionaryKeyCallBacks,
    &kCFTypeDictionaryValueCallBacks
  );
  Boolean trusted = AXIsProcessTrustedWithOptions(options);
  CFRelease(options);
  if (!trusted) {
    fprintf(stderr, "Keyboard permission was denied. Enable roblox-piano-keyboard in System Settings > Privacy & Security > Accessibility, then try again.\n");
    return 2;
  }

  char line[512];
  while (fgets(line, sizeof(line), stdin)) {
    if (strncmp(line, "END", 3) == 0) break;

    char *keys = strtok(line, "|");
    char *stepsText = strtok(NULL, "|");
    char *stepUsText = strtok(NULL, "|");
    char *holdText = strtok(NULL, "|\n");
    if (!keys || !stepsText || !stepUsText || !holdText) continue;

    long steps = strtol(stepsText, NULL, 10);
    long stepUs = strtol(stepUsText, NULL, 10);
    double hold = strtod(holdText, NULL);
    if (steps < 1) steps = 1;
    if (hold < 0.05) hold = 0.05;
    if (hold > 0.98) hold = 0.98;
    useconds_t duration = (useconds_t)(steps * stepUs);

    for (size_t i = 0; keys[i]; i++) post_key(keys[i], 1);
    usleep((useconds_t)(duration * hold));
    for (size_t i = strlen(keys); i > 0; i--) post_key(keys[i - 1], 0);
    usleep((useconds_t)(duration * (1.0 - hold)));
  }
  release_all();
  return 0;
}
