# LightningBuild

Extremely fast dev builds (<150ms js, <100ms sass) served directly from cache: esbuild + injected node-sass + cache-resistant sourcemaps + automatic browserSync + chokidar profiling. Performant down to 100ms auto-save, code2browser in under 1-3s.

## The build process
1. In the first run we do all the tasks and set the ground up for incremental builds.

2. The watcher (non-polling fs API if at all possible) registers all changes and runs the task that is associated with the extension of the file that is changed, using minimum work allocation. All outputs are mapped to request URL's. The tasks are as follows:
- JS - esbuild bundles and hashes the outputs.
- SASS - compiled using node-sass. Injected via stream from the memory. A mock output file is created and touched on source change to trick browserSync into injecting the data.
- static files - HTML is served from the memory, while other resources are served directly from their src folders. HTML files are rewritten to use links that refer to hashed files.

3. Each task run is followed by a browserSync injection/reload (depends on browser file injection capabilities). All outputs are loaded directly from memory via browserSync server middleware.

   
## Future features
#### Scrolling
Preserving scroll position on full reload seems exceptionally difficult. One possibility is to make a custom browserSync script rewrite that caches the scroll position of every element that has a certain scrolling class. In this case, We would also add a [data-scrolling] value to the element. This value would be either the element ID or a hash of something that is both highly specific and deterministic (what??). On reload we would then try to apply the position both immediately and after some time (~5s, if there is a fetch event? - but then it could break our own scrolling?).

#### Builds
Create gulp.js task queues and configurations? Need additional testing on gulp.js overhead regarding dev env.

#### Images and other static files
Change currently requires restart or cache disable.


## Bugs
#### HTML injection
HTML injection into the body tag is broken, so it's disabled at the moment.

#### vendor.js
esbuild currently doesn't support "configurable" (i.e. using regex) chunks, so vendor.js cannot be created. This is not fixable (and according to the creator probably never will be). Another JS builder needs to be used to support these kinds of builds.

#### VCS 
There are issues with multiple simultaneous changes (i.e. VCS). For now this will suffice for dev purposes, but this needs to be tested and appropriately addressed eventually.

#### Babel
Disabled until node.js has been updated since the esbuild plugin is using ES6 modules (try different versions!).

#### HTML defines
Not implemented yet.

#### Various
Path consistency, config consistency, error handling on initAllTask (should exit process), folder setup and cleanup, files being served over the file system, config testing, real change profiling (currently the cache is fucking up the numbers), html single file task, ugly defines because of grunt compatibility, encapsulate as an NPM package, heavy refactoring (SRP, consistency, long functions, magic numbers...).
