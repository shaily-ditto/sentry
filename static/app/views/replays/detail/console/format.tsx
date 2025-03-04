// This is based on https://github.com/browserify/node-util/blob/master/util.js
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
import {Fragment} from 'react';
import isObject from 'lodash/isObject';

import ObjectInspector, {OnExpand} from 'sentry/components/objectInspector';

const formatRegExp = /%[sdj%]/g;

function isNull(arg: unknown) {
  return arg === null;
}
interface FormatProps {
  args: any[];
  expandPaths?: string[];
  onExpand?: OnExpand;
}

/**
 * Based on node's `util.format()`, returns a formatted "string" using the
 * first argument as a printf-like format string which can contain zero or more
 * format specifiers. Uses `<ObjectInspector>` to print objects.
 *
 * %c is ignored for now
 */
export default function Format({onExpand, expandPaths, args}: FormatProps) {
  const f = args[0];

  if (typeof f !== 'string') {
    const objects: any[] = [];
    for (let i = 0; i < args.length; i++) {
      objects.push(
        <ObjectInspector
          key={i}
          data={args[i]}
          expandPaths={expandPaths}
          onExpand={onExpand}
        />
      );
    }
    return <Fragment>{objects}</Fragment>;
  }

  let i = 1;
  const len = args.length;
  const pieces: any[] = [];

  // @ts-expect-error ts does not like that this can return an integer (e.g. for `%d`)
  const str = String(f).replace(formatRegExp, function (x) {
    if (x === '%%') {
      return '%';
    }
    if (i >= len) {
      return x;
    }
    switch (x) {
      case '%s':
        return String(args[i++]);
      case '%d':
        return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });

  pieces.push(str);
  for (let x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      pieces.push(' ' + x);
    } else {
      pieces.push(' ');
      pieces.push(
        <ObjectInspector key={i} data={x} expandPaths={expandPaths} onExpand={onExpand} />
      );
    }
  }
  return <Fragment>{pieces}</Fragment>;
}
