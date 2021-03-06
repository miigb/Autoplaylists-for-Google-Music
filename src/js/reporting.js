'use strict';
const Raven = require('raven-js');

const Context = require('./context');

const limiter = {};

Raven
.config('https://ea691c5833f34aa085df5e5aee9a46f3@app.getsentry.com/66349', {
  release: chrome.runtime.getManifest().version,
  shouldSendCallback: data => {
    // rate limit error sending.
    // source: https://github.com/getsentry/raven-js/issues/435#issuecomment-183021031
    if (data.message in limiter) {
      return false;
    }

    limiter[data.message] = true;

    setTimeout(() => {
      delete limiter[data.message];
    }, 1000 * 60 * 10);

    return true;
  },
})
.install();
exports.Raven = Raven;

const GAService = analytics.getService('autoplaylists');
const GATracker = GAService.getTracker('UA-71628085-3');
exports.GAService = GAService;
exports.GATracker = GATracker;

let cachedContext = null;

// action is one of 'success', 'retry', or 'failure'.
// label is optional, and can be something like 'gave-up' or 'failed-reorder'.
exports.reportSync = function reportSync(action, label) {
  // Note that due to GA's serverside rate limiting, this can drop bursty events.
  // If this becomes a problem, consider something like http://stackoverflow.com/a/9340290/1231454.

  if (!cachedContext) {
    // setContext should make this available very quickly after loading.
    setTimeout(reportSync, 1000, action, label);
  } else {
    let sync = analytics.EventBuilder.builder()
    .category('sync')
    .action(action);

    if (arguments.length === 2) {
      sync = sync.label(label);
    }

    GATracker.send(sync);
  }
};

// action is 'success' or 'failure'
// type is 'Playlist' or 'Entry'
// value is the number of mutations being sent
exports.reportNewSync = function reportNewSync(action, type, value) {
  if (!cachedContext) {
    // setContext should make this available very quickly after loading.
    setTimeout(reportNewSync, 1000, action, type, value);
  } else {
    const category = 'newSync' + type;
    const sync = analytics.EventBuilder.builder()
    .category(category)
    .action(action)
    .value(value);

    GATracker.send(sync);
  }
};

// type is 'playlist' or 'entry'
// mutations is a list of mutations
exports.reportMutationBatch = function reportMutationBatch(type, mutations) {
  if (!cachedContext) {
    setTimeout(reportMutationBatch, 1000, type, mutations);
  } else {
    const category = type + 'MutationBatch';
    const counts = getMutationCounts(mutations);

    for (const mutationType in counts) {
      const count = counts[mutationType];
      if (count === 0) {
        // I'm not entirely sure if this is the best way to report this.
        // It makes comparing batch breakdown a bit harder (the denominator differs across averages),
        // but gives slightly more information (how often there are no mutations of a type).
        continue;
      }

      const batch = analytics.EventBuilder.builder()
      .category(category)
      .action(mutationType)
      .value(count);

      GATracker.send(batch);
    }
  }
};

function getMutationCounts(mutations) {
  const counts = {
    'create': 0,
    'update': 0,
    'delete': 0,
  };
  mutations.forEach(mutation => {
    // Mutations will only have one key at the top level.
    const type = Object.keys(mutation)[0];
    counts[type]++;
  });

  return counts;
}

// num is the number of mixed reorders present in the sync.
exports.reportMixedReorders = function reportMixedReorders(num) {
  if (!cachedContext) {
    setTimeout(reportMixedReorders, 1000, num);
  } else if (num > 0) {
    const reorders = analytics.EventBuilder.builder()
    .category('mixedReorders')
    .action('present')
    .value(num);

    GATracker.send(reorders);
  }
};


// action is one of 'valid' or 'invalid'.
exports.reportActivation = function reportActivation(action) {
  if (!cachedContext) {
    setTimeout(reportActivation, 1000, action);
  } else {
    const activation = analytics.EventBuilder.builder()
    .category('activation')
    .action(action);

    GATracker.send(activation);
  }
};

// action is one of 'valid' or 'invalid'.
// label describes what triggered the prompt and whether it was interactive, eg startupN, licenseI.
exports.reportAuth = function reportAuth(action, label) {
  if (!cachedContext) {
    setTimeout(reportAuth, 1000, action, label);
  } else {
    const auth = analytics.EventBuilder.builder()
    .category('oauth')
    .action(action)
    .label(label);

    GATracker.send(auth);
  }
};

exports.reportHit = function reportHit(view) {
  if (!cachedContext) {
    setTimeout(reportHit, 1000, view);
  } else {
    GATracker.sendAppView(view);
  }
};


// FIXME there's a race between doing reporting and setting the context.
// It won't be attached for very early messages.
function setContext(isBackground, context) {
  console.log('setting context:', isBackground, context);

  cachedContext = context;

  GATracker.set('userId', context.reportingUUID);
  GATracker.set('dimension1', context.tags.hasFullVersion ? 'full' : 'free');
  GATracker.set('dimension2', context.tags.isDeveloper ? 'yes' : 'no');

  Raven.setUserContext(context.user);
  context.tags.isBackground = isBackground; // eslint-disable-line no-param-reassign
  Raven.setTagsContext(context.tags);
}

if (chrome.identity && chrome.management) {
  // If we're the background script, we can get the context directly.
  Context.get(context => {
    setContext(true, context);
  });
} else {
  chrome.runtime.sendMessage({action: 'getContext'}, context => {
    setContext(false, context);
  });
}
