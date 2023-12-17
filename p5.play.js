/*
p5.play
by Paolo Pedercini/molleindustria, 2015
http://molleindustria.org/
*/

(function(root, factory) {
if (typeof define === 'function' && define.amd)
define('p5.play', ['@code-dot-org/p5'], function(p5) { (factory(p5)); });
else if (typeof exports === 'object')
factory(require('@code-dot-org/p5'));
else
factory(root.p5);
}(this, function(p5) {
/**
 * p5.play is a library for p5.js to facilitate the creation of games and gamelike
 * projects.
 *
 * It provides a flexible Sprite class to manage visual objects in 2D space
 * and features such as animation support, basic collision detection
 * and resolution, mouse and keyboard interactions, and a virtual camera.
 *
 * p5.play is not a box2D-derived physics engine, it doesn't use events, and it's
 * designed to be understood and possibly modified by intermediate programmers.
 *
 * See the examples folder for more info on how to use this library.
 *
 * @module p5.play
 * @submodule p5.play
 * @for p5.play
 * @main
 */

// =============================================================================
//                         initialization
// =============================================================================

var DEFAULT_FRAME_RATE = 30;

// This is the new way to initialize custom p5 properties for any p5 instance.
// The goal is to migrate lazy P5 properties over to this method.
// @see https://github.com/molleindustria/p5.play/issues/46
p5.prototype.registerMethod('init', function p5PlayInit() {
  /**
   * The sketch camera automatically created at the beginning of a sketch.
   * A camera facilitates scrolling and zooming for scenes extending beyond
   * the canvas. A camera has a position, a zoom factor, and the mouse
   * coordinates relative to the view.
   *
   * In p5.js terms the camera wraps the whole drawing cycle in a
   * transformation matrix but it can be disabled anytime during the draw
   * cycle, for example to draw interface elements in an absolute position.
   *
   * @property camera
   * @type {camera}
   */
  this.camera = new Camera(this, 0, 0, 1);
  this.camera.init = false;

  this.angleMode(this.DEGREES);
  this.frameRate(DEFAULT_FRAME_RATE);

  this._defaultCanvasSize = {
    width: 400,
    height: 400
  };

  var startDate = new Date();
  this._startTime = startDate.getTime();

  // Temporary canvas for supporting tint operations from image elements;
  // see p5.prototype.imageElement()
  this._tempCanvas = document.createElement('canvas');
});

// This provides a way for us to lazily define properties that
// are global to p5 instances.
//
// Note that this isn't just an optimization: p5 currently provides no
// way for add-ons to be notified when new p5 instances are created, so
// lazily creating these properties is the *only* mechanism available
// to us. For more information, see:
//
// https://github.com/processing/p5.js/issues/1263
function defineLazyP5Property(name, getter) {
  Object.defineProperty(p5.prototype, name, {
    configurable: true,
    enumerable: true,
    get: function() {
      var context = (this instanceof p5 && !this._isGlobal) ? this : window;

      if (typeof(context._p5PlayProperties) === 'undefined') {
        context._p5PlayProperties = {};
      }
      if (!(name in context._p5PlayProperties)) {
        context._p5PlayProperties[name] = getter.call(context);
      }
      return context._p5PlayProperties[name];
    }
  });
}

// This returns a factory function, suitable for passing to
// defineLazyP5Property, that returns a subclass of the given
// constructor that is always bound to a particular p5 instance.
function boundConstructorFactory(constructor) {
  if (typeof(constructor) !== 'function')
    throw new Error('constructor must be a function');

  return function createBoundConstructor() {
    var pInst = this;

    function F() {
      var args = Array.prototype.slice.call(arguments);

      return constructor.apply(this, [pInst].concat(args));
    }
    F.prototype = constructor.prototype;

    return F;
  };
}

// This is a utility that makes it easy to define convenient aliases to
// pre-bound p5 instance methods.
//
// For example:
//
//   var pInstBind = createPInstBinder(pInst);
//
//   var createVector = pInstBind('createVector');
//   var loadImage = pInstBind('loadImage');
//
// The above will create functions createVector and loadImage, which can be
// used similar to p5 global mode--however, they're bound to specific p5
// instances, and can thus be used outside of global mode.
function createPInstBinder(pInst) {
  return function pInstBind(methodName) {
    var method = pInst[methodName];

    if (typeof(method) !== 'function')
      throw new Error('"' + methodName + '" is not a p5 method');
    return method.bind(pInst);
  };
}

// These are utility p5 functions that don't depend on p5 instance state in
// order to work properly, so we'll go ahead and make them easy to
// access without needing to bind them to a p5 instance.
var abs = p5.prototype.abs;
var radians = p5.prototype.radians;
var degrees = p5.prototype.degrees;

// =============================================================================
//                         p5 overrides
// =============================================================================

// Make the fill color default to gray (127, 127, 127) each time a new canvas is
// created.
if (!p5.prototype.originalCreateCanvas_) {
  p5.prototype.originalCreateCanvas_ = p5.prototype.createCanvas;
  p5.prototype.createCanvas = function() {
    var result = this.originalCreateCanvas_.apply(this, arguments);
    this.fill(this.color(127, 127, 127));
    return result;
  };
}

// Make width and height optional for ellipse() - default to 50
// Save the original implementation to allow for optional parameters.
if (!p5.prototype.originalEllipse_) {
  p5.prototype.originalEllipse_ = p5.prototype.ellipse;
  p5.prototype.ellipse = function(x, y, w, h) {
    w = (w) ? w : 50;
    h = (w && !h) ? w : h;
    this.originalEllipse_(x, y, w, h);
  };
}

// Make width and height optional for rect() - default to 50
// Save the original implementation to allow for optional parameters.
if (!p5.prototype.originalRect_) {
  p5.prototype.originalRect_ = p5.prototype.rect;
  p5.prototype.rect = function(x, y, w, h) {
    w = (w) ? w : 50;
    h = (w && !h) ? w : h;
    this.originalRect_(x, y, w, h);
  };
}

// Modify p5 to ignore out-of-bounds positions before setting touchIsDown
p5.prototype._ontouchstart = function(e) {
  if (!this._curElement) {
    return;
  }
  var validTouch;
  for (var i = 0; i < e.touches.length; i++) {
    validTouch = getTouchInfo(this._curElement.elt, e, i);
    if (validTouch) {
      break;
    }
  }
  if (!validTouch) {
    // No in-bounds (valid) touches, return and ignore:
    return;
  }
  var context = this._isGlobal ? window : this;
  var executeDefault;
  this._updateNextTouchCoords(e);
  this._updateNextMouseCoords(e);
  this._setProperty('touchIsDown', true);
  if (typeof context.touchStarted === 'function') {
    executeDefault = context.touchStarted(e);
    if (executeDefault === false) {
      e.preventDefault();
    }
  } else if (typeof context.mousePressed === 'function') {
    executeDefault = context.mousePressed(e);
    if (executeDefault === false) {
      e.preventDefault();
    }
    //this._setMouseButton(e);
  }
};

// Modify p5 to handle CSS transforms (scale) and ignore out-of-bounds
// positions before reporting touch coordinates
//
// NOTE: _updateNextTouchCoords() is nearly identical, but calls a modified
// getTouchInfo() function below that scales the touch postion with the play
// space and can return undefined
p5.prototype._updateNextTouchCoords = function(e) {
  var x = this.touchX;
  var y = this.touchY;
  if (e.type === 'mousedown' || e.type === 'mousemove' ||
      e.type === 'mouseup' || !e.touches) {
    x = this.mouseX;
    y = this.mouseY;
  } else {
    if (this._curElement !== null) {
      var touchInfo = getTouchInfo(this._curElement.elt, e, 0);
      if (touchInfo) {
        x = touchInfo.x;
        y = touchInfo.y;
      }

      var touches = [];
      var touchIndex = 0;
      for (var i = 0; i < e.touches.length; i++) {
        // Only some touches are valid - only push valid touches into the
        // array for the `touches` property.
        touchInfo = getTouchInfo(this._curElement.elt, e, i);
        if (touchInfo) {
          touches[touchIndex] = touchInfo;
          touchIndex++;
        }
      }
      this._setProperty('touches', touches);
    }
  }
  this._setProperty('touchX', x);
  this._setProperty('touchY', y);
  if (!this._hasTouchInteracted) {
    // For first draw, make previous and next equal
    this._updateTouchCoords();
    this._setProperty('_hasTouchInteracted', true);
  }
};

// NOTE: returns undefined if the position is outside of the valid range
function getTouchInfo(canvas, e, i) {
  i = i || 0;
  var rect = canvas.getBoundingClientRect();
  var touch = e.touches[i] || e.changedTouches[i];
  var xPos = touch.clientX - rect.left;
  var yPos = touch.clientY - rect.top;
  if (xPos >= 0 && xPos < rect.width && yPos >= 0 && yPos < rect.height) {
    return {
      x: Math.round(xPos * canvas.offsetWidth / rect.width),
      y: Math.round(yPos * canvas.offsetHeight / rect.height),
      id: touch.identifier
    };
  }
}

// Modify p5 to ignore out-of-bounds positions before setting mouseIsPressed
// and isMousePressed
p5.prototype._onmousedown = function(e) {
  if (!this._curElement) {
    return;
  }
  if (!getMousePos(this._curElement.elt, e)) {
    // Not in-bounds, return and ignore:
    return;
  }
  var context = this._isGlobal ? window : this;
  var executeDefault;
  this._setProperty('isMousePressed', true);
  this._setProperty('mouseIsPressed', true);
  this._setMouseButton(e);
  this._updateNextMouseCoords(e);
  this._updateNextTouchCoords(e);
  if (typeof context.mousePressed === 'function') {
    executeDefault = context.mousePressed(e);
    if (executeDefault === false) {
      e.preventDefault();
    }
  } else if (typeof context.touchStarted === 'function') {
    executeDefault = context.touchStarted(e);
    if (executeDefault === false) {
      e.preventDefault();
    }
  }
};

// Modify p5 to handle CSS transforms (scale) and ignore out-of-bounds
// positions before reporting mouse coordinates
//
// NOTE: _updateNextMouseCoords() is nearly identical, but calls a modified
// getMousePos() function below that scales the mouse position with the play
// space and can return undefined.
p5.prototype._updateNextMouseCoords = function(e) {
  var x = this.mouseX;
  var y = this.mouseY;
  if (e.type === 'touchstart' || e.type === 'touchmove' ||
      e.type === 'touchend' || e.touches) {
    x = this.touchX;
    y = this.touchY;
  } else if (this._curElement !== null) {
    var mousePos = getMousePos(this._curElement.elt, e);
    if (mousePos) {
      x = mousePos.x;
      y = mousePos.y;
    }
  }
  this._setProperty('mouseX', x);
  this._setProperty('mouseY', y);
  this._setProperty('winMouseX', e.pageX);
  this._setProperty('winMouseY', e.pageY);
  if (!this._hasMouseInteracted) {
    // For first draw, make previous and next equal
    this._updateMouseCoords();
    this._setProperty('_hasMouseInteracted', true);
  }
};

// NOTE: returns undefined if the position is outside of the valid range
function getMousePos(canvas, evt) {
  var rect = canvas.getBoundingClientRect();
  var xPos = evt.clientX - rect.left;
  var yPos = evt.clientY - rect.top;
  if (xPos >= 0 && xPos < rect.width && yPos >= 0 && yPos < rect.height) {
    return {
      x: Math.round(xPos * canvas.offsetWidth / rect.width),
      y: Math.round(yPos * canvas.offsetHeight / rect.height)
    };
  }
}

// =============================================================================
//                         p5 extensions
// TODO: It'd be nice to get these accepted upstream in p5
// =============================================================================

/**
 * Projects a vector onto the line parallel to a second vector, giving a third
 * vector which is the orthogonal projection of that vector onto the line.
 * @see https://en.wikipedia.org/wiki/Vector_projection
 * @method project
 * @for p5.Vector
 * @static
 * @param {p5.Vector} a - vector being projected
 * @param {p5.Vector} b - vector defining the projection target line.
 * @return {p5.Vector} projection of a onto the line parallel to b.
 */
p5.Vector.project = function(a, b) {
  return p5.Vector.mult(b, p5.Vector.dot(a, b) / p5.Vector.dot(b, b));
};

/**
 * Ask whether a vector is parallel to this one.
 * @method isParallel
 * @for p5.Vector
 * @param {p5.Vector} v2
 * @param {number} [tolerance] - margin of error for comparisons, comes into
 *        play when comparing rotated vectors.  For example, we want
 *        <1, 0> to be parallel to <0, 1>.rot(Math.PI/2) but float imprecision
 *        can get in the way of that.
 * @return {boolean}
 */
p5.Vector.prototype.isParallel = function(v2, tolerance) {
  tolerance = typeof tolerance === 'number' ? tolerance : 1e-14;
  return (
      Math.abs(this.x) < tolerance && Math.abs(v2.x) < tolerance
    ) || (
      Math.abs(this.y ) < tolerance && Math.abs(v2.y) < tolerance
    ) || (
      Math.abs(this.x / v2.x - this.y / v2.y) < tolerance
    );
};

// =============================================================================
//                         p5 additions
// =============================================================================

/**
 * Loads an image from a path and creates an Image from it.
 * <br><br>
 * The image may not be immediately available for rendering
 * If you want to ensure that the image is ready before doing
 * anything with it, place the loadImageElement() call in preload().
 * You may also supply a callback function to handle the image when it's ready.
 * <br><br>
 * The path to the image should be relative to the HTML file
 * that links in your sketch. Loading an from a URL or other
 * remote location may be blocked due to your browser's built-in
 * security.
 *
 * @method loadImageElement
 * @param  {String} path Path of the image to be loaded
 * @param  {Function(Image)} [successCallback] Function to be called once
 *                                the image is loaded. Will be passed the
 *                                Image.
 * @param  {Function(Event)}    [failureCallback] called with event error if
 *                                the image fails to load.
 * @return {Image}                the Image object
 */
p5.prototype.loadImageElement = function(path, successCallback, failureCallback) {
  var img = new Image();
  var decrementPreload = p5._getDecrementPreload.apply(this, arguments);

  img.onload = function() {
    if (typeof successCallback === 'function') {
      successCallback(img);
    }
    if (decrementPreload && (successCallback !== decrementPreload)) {
      decrementPreload();
    }
  };
  img.onerror = function(e) {
    p5._friendlyFileLoadError(0, img.src);
    // don't get failure callback mixed up with decrementPreload
    if ((typeof failureCallback === 'function') &&
      (failureCallback !== decrementPreload)) {
      failureCallback(e);
    }
  };

  //set crossOrigin in case image is served which CORS headers
  //this will let us draw to canvas without tainting it.
  //see https://developer.mozilla.org/en-US/docs/HTML/CORS_Enabled_Image
  // When using data-uris the file will be loaded locally
  // so we don't need to worry about crossOrigin with base64 file types
  if(path.indexOf('data:image/') !== 0) {
    img.crossOrigin = 'Anonymous';
  }

  //start loading the image
  img.src = path;

  return img;
};

/**
 * Draw an image element to the main canvas of the p5js sketch
 *
 * @method imageElement
 * @param  {Image}    imgEl    the image to display
 * @param  {Number}   [sx=0]   The X coordinate of the top left corner of the
 *                             sub-rectangle of the source image to draw into
 *                             the destination canvas.
 * @param  {Number}   [sy=0]   The Y coordinate of the top left corner of the
 *                             sub-rectangle of the source image to draw into
 *                             the destination canvas.
 * @param {Number} [sWidth=imgEl.width] The width of the sub-rectangle of the
 *                                      source image to draw into the destination
 *                                      canvas.
 * @param {Number} [sHeight=imgEl.height] The height of the sub-rectangle of the
 *                                        source image to draw into the
 *                                        destination context.
 * @param  {Number}   [dx=0]    The X coordinate in the destination canvas at
 *                              which to place the top-left corner of the
 *                              source image.
 * @param  {Number}   [dy=0]    The Y coordinate in the destination canvas at
 *                              which to place the top-left corner of the
 *                              source image.
 * @param  {Number}   [dWidth]  The width to draw the image in the destination
 *                              canvas. This allows scaling of the drawn image.
 * @param  {Number}   [dHeight] The height to draw the image in the destination
 *                              canvas. This allows scaling of the drawn image.
 * @example
 * <div>
 * <code>
 * var imgEl;
 * function preload() {
 *   imgEl = loadImageElement("assets/laDefense.jpg");
 * }
 * function setup() {
 *   imageElement(imgEl, 0, 0);
 *   imageElement(imgEl, 0, 0, 100, 100);
 *   imageElement(imgEl, 0, 0, 100, 100, 0, 0, 100, 100);
 * }
 * </code>
 * </div>
 * <div>
 * <code>
 * function setup() {
 *   // here we use a callback to display the image after loading
 *   loadImageElement("assets/laDefense.jpg", function(imgEl) {
 *     imageElement(imgEl, 0, 0);
 *   });
 * }
 * </code>
 * </div>
 *
 * @alt
 * image of the underside of a white umbrella and grided ceiling above
 * image of the underside of a white umbrella and grided ceiling above
 *
 */
p5.prototype.imageElement = function(imgEl, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight) {
  /**
   * Validates clipping params. Per drawImage spec sWidth and sHight cannot be
   * negative or greater than image intrinsic width and height
   * @private
   * @param {Number} sVal
   * @param {Number} iVal
   * @returns {Number}
   * @private
   */
  function _sAssign(sVal, iVal) {
    if (sVal > 0 && sVal < iVal) {
      return sVal;
    }
    else {
      return iVal;
    }
  }

  function modeAdjust(a, b, c, d, mode) {
    if (mode === p5.prototype.CORNER) {
      return {x: a, y: b, w: c, h: d};
    } else if (mode === p5.prototype.CORNERS) {
      return {x: a, y: b, w: c-a, h: d-b};
    } else if (mode === p5.prototype.RADIUS) {
      return {x: a-c, y: b-d, w: 2*c, h: 2*d};
    } else if (mode === p5.prototype.CENTER) {
      return {x: a-c*0.5, y: b-d*0.5, w: c, h: d};
    }
  }

  if (arguments.length <= 5) {
    dx = sx || 0;
    dy = sy || 0;
    sx = 0;
    sy = 0;
    dWidth = sWidth || imgEl.width;
    dHeight = sHeight || imgEl.height;
    sWidth = imgEl.width;
    sHeight = imgEl.height;
  } else if (arguments.length === 9) {
    sx = sx || 0;
    sy = sy || 0;
    sWidth = _sAssign(sWidth, imgEl.width);
    sHeight = _sAssign(sHeight, imgEl.height);

    dx = dx || 0;
    dy = dy || 0;
    dWidth = dWidth || imgEl.width;
    dHeight = dHeight || imgEl.height;
  } else {
    throw 'Wrong number of arguments to imageElement()';
  }

  var vals = modeAdjust(dx, dy, dWidth, dHeight,
    this._renderer._imageMode);

  if (this._renderer._tint) {
    // Just-in-time create/draw into a temp canvas so tinting can
    // work within the renderer as it would for a p5.Image
    // Only resize canvas if it's too small
    var context = this._tempCanvas.getContext('2d');
    if (this._tempCanvas.width < vals.w || this._tempCanvas.height < vals.h) {
      this._tempCanvas.width = Math.max(this._tempCanvas.width, vals.w);
      this._tempCanvas.height = Math.max(this._tempCanvas.height, vals.h);
    } else {
      context.clearRect(0, 0, vals.w, vals.h);
    }
    context.drawImage(imgEl,
      sx, sy, sWidth, sHeight,
      0, 0, vals.w, vals.h);
    // Call the renderer's image() method with an object that contains the Image
    // as an 'elt' property and the temp canvas as well (when needed):
    this._renderer.image({canvas: this._tempCanvas},
      0, 0, vals.w, vals.h,
      vals.x, vals.y, vals.w, vals.h);
  } else {
    this._renderer.image({elt: imgEl},
      sx, sy, sWidth, sHeight,
      vals.x, vals.y, vals.w, vals.h);
  }
};

/**
* A Group containing all the sprites in the sketch.
*
* @property allSprites
* @for p5.play
* @type {Group}
*/

defineLazyP5Property('allSprites', function() {
  return new p5.prototype.Group();
});

p5.prototype._mouseButtonIsPressed = function(buttonCode) {
  return (this.mouseIsPressed && this.mouseButton === buttonCode) ||
    (this.touchIsDown && buttonCode === this.LEFT);
};

p5.prototype.mouseDidMove = function() {
  return this.pmouseX !== this.mouseX || this.pmouseY !== this.mouseY;
};

p5.prototype.mouseIsOver = function(sprite) {
  if (!sprite) {
    return false;
  }

  if (!sprite.collider) {
    sprite.setDefaultCollider();
  }

  var mousePosition;
  if (this.camera.active) {
    mousePosition = this.createVector(this.camera.mouseX, this.camera.mouseY);
  } else {
    mousePosition = this.createVector(this.mouseX, this.mouseY);
  }

  return sprite.collider.overlap(new window.p5.PointCollider(mousePosition));
};

p5.prototype.mousePressedOver = function(sprite) {
  return (this.mouseIsPressed || this.touchIsDown) && this.mouseIsOver(sprite);
};

var styleEmpty = 'rgba(0,0,0,0)';

p5.Renderer2D.prototype.regularPolygon = function(x, y, sides, size, rotation) {
  var ctx = this.drawingContext;
  var doFill = this._doFill, doStroke = this._doStroke;
  if (doFill && !doStroke) {
    if (ctx.fillStyle === styleEmpty) {
      return this;
    }
  } else if (!doFill && doStroke) {
    if (ctx.strokeStyle === styleEmpty) {
      return this;
    }
  }
  if (sides < 3) {
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + size * Math.cos(rotation), y + size * Math.sin(rotation));
  for (var i = 1; i < sides; i++) {
    var angle = rotation + (i * 2 * Math.PI / sides);
    ctx.lineTo(x + size * Math.cos(angle), y + size * Math.sin(angle));
  }
  ctx.closePath();
  if (doFill) {
    ctx.fill();
  }
  if (doStroke) {
    ctx.stroke();
  }
};

p5.prototype.regularPolygon = function(x, y, sides, size, rotation) {
  if (!this._renderer._doStroke && !this._renderer._doFill) {
    return this;
  }
  var args = new Array(arguments.length);
  for (var i = 0; i < args.length; ++i) {
    args[i] = arguments[i];
  }

  if (typeof rotation === 'undefined') {
    rotation = -(Math.PI / 2);
    if (0 === sides % 2) {
      rotation += Math.PI / sides;
    }
  } else if (this._angleMode === this.DEGREES) {
    rotation = this.radians(rotation);
  }

  // NOTE: only implemented for non-3D
  if (!this._renderer.isP3D) {
    this._validateParameters(
      'regularPolygon',
      args,
      [
        ['Number', 'Number', 'Number', 'Number'],
        ['Number', 'Number', 'Number', 'Number', 'Number']
      ]
    );
    this._renderer.regularPolygon(
      args[0],
      args[1],
      args[2],
      args[3],
      rotation
    );
  }
  return this;
};

p5.Renderer2D.prototype.shape = function() {
  var ctx = this.drawingContext;
  var doFill = this._doFill, doStroke = this._doStroke;
  if (doFill && !doStroke) {
    if (ctx.fillStyle === styleEmpty) {
      return this;
    }
  } else if (!doFill && doStroke) {
    if (ctx.strokeStyle === styleEmpty) {
      return this;
    }
  }
  var numCoords = arguments.length / 2;
  if (numCoords < 1) {
    return;
  }
  ctx.beginPath();
  ctx.moveTo(arguments[0], arguments[1]);
  for (var i = 1; i < numCoords; i++) {
    ctx.lineTo(arguments[i * 2], arguments[i * 2 + 1]);
  }
  ctx.closePath();
  if (doFill) {
    ctx.fill();
  }
  if (doStroke) {
    ctx.stroke();
  }
};

p5.prototype.shape = function() {
  if (!this._renderer._doStroke && !this._renderer._doFill) {
    return this;
  }
  // NOTE: only implemented for non-3D
  if (!this._renderer.isP3D) {
    // TODO: call this._validateParameters, once it is working in p5.js and
    // we understand if it can be used for var args functions like this
    this._renderer.shape.apply(this._renderer, arguments);
  }
  return this;
};

p5.prototype.rgb = function(r, g, b, a) {
  // convert a from 0 to 255 to 0 to 1
  if (!a) {
    a = 1;
  }
  a = a * 255;

  return this.color(r, g, b, a);
};

p5.prototype.createGroup = function() {
  return new this.Group();
};

defineLazyP5Property('World', function() {
  var World = {
    pInst: this
  };

  function createReadOnlyP5PropertyAlias(name) {
    Object.defineProperty(World, name, {
      enumerable: true,
      get: function() {
        return this.pInst[name];
      }
    });
  }

  createReadOnlyP5PropertyAlias('width');
  createReadOnlyP5PropertyAlias('height');
  createReadOnlyP5PropertyAlias('mouseX');
  createReadOnlyP5PropertyAlias('mouseY');
  createReadOnlyP5PropertyAlias('allSprites');
  createReadOnlyP5PropertyAlias('frameCount');

  Object.defineProperty(World, 'frameRate', {
    enumerable: true,
    get: function() {
      return this.pInst.frameRate();
    },
    set: function(value) {
      this.pInst.frameRate(value);
    }
  });

  Object.defineProperty(World, 'seconds', {
    enumerable: true,
    get: function() {
      var currentDate = new Date();
      var currentTime = currentDate.getTime();
      return Math.round((currentTime - this.pInst._startTime) / 1000);
    }
  });

  return World;
});

p5.prototype.spriteUpdate = true;

/**
   * A Sprite is the main building block of p5.play:
   * an element able to store images or animations with a set of
   * properties such as position and visibility.
   * A Sprite can have a collider that defines the active area to detect
   * collisions or overlappings with other sprites and mouse interactions.
   *
   * Sprites created using createSprite (the preferred way) are added to the
   * allSprites group and given a depth value that puts it in front of all
   * other sprites.
   *
   * @method createSprite
   * @param {Number} x Initial x coordinate
   * @param {Number} y Initial y coordinate
   * @param {Number} width Width of the placeholder rectangle and of the
   *                       collider until an image or new collider are set
   * @param {Number} height Height of the placeholder rectangle and of the
   *                       collider until an image or new collider are set
   * @return {Object} The new sprite instance
   */

p5.prototype.createSprite = function(x, y, width, height) {
  var s = new Sprite(this, x, y, width, height);
  s.depth = this.allSprites.maxDepth()+1;
  this.allSprites.add(s);
  return s;
};


/**
   * Removes a Sprite from the sketch.
   * The removed Sprite won't be drawn or updated anymore.
   * Equivalent to Sprite.remove()
   *
   * @method removeSprite
   * @param {Object} sprite Sprite to be removed
*/
p5.prototype.removeSprite = function(sprite) {
  sprite.remove();
};

/**
* Updates all the sprites in the sketch (position, animation...)
* it's called automatically at every draw().
* It can be paused by passing a parameter true or false;
* Note: it does not render the sprites.
*
* @method updateSprites
* @param {Boolean} updating false to pause the update, true to resume
*/
p5.prototype.updateSprites = function(upd) {

  if(upd === false)
    this.spriteUpdate = false;
  if(upd === true)
    this.spriteUpdate = true;

  if(this.spriteUpdate)
  for(var i = 0; i<this.allSprites.size(); i++)
  {
    this.allSprites.get(i).update();
  }
};

/**
* Returns all the sprites in the sketch as an array
*
* @method getSprites
* @return {Array} Array of Sprites
*/
p5.prototype.getSprites = function() {

  //draw everything
  if(arguments.length===0)
  {
    return this.allSprites.toArray();
  }
  else
  {
    var arr = [];
    //for every tag
    for(var j=0; j<arguments.length; j++)
    {
      for(var i = 0; i<this.allSprites.size(); i++)
      {
        if(this.allSprites.get(i).isTagged(arguments[j]))
          arr.push(this.allSprites.get(i));
      }
    }

    return arr;
  }

};

/**
* Displays a Group of sprites.
* If no parameter is specified, draws all sprites in the
* sketch.
* The drawing order is determined by the Sprite property "depth"
*
* @method drawSprites
* @param {Group} [group] Group of Sprites to be displayed
*/
p5.prototype.drawSprites = function(group) {
  // If no group is provided, draw the allSprites group.
  group = group || this.allSprites;

  if (typeof group.draw !== 'function')
  {
    throw('Error: with drawSprites you can only draw all sprites or a group');
  }

  group.draw();
};

/**
* Displays a Sprite.
* To be typically used in the main draw function.
*
* @method drawSprite
* @param {Sprite} sprite Sprite to be displayed
*/
p5.prototype.drawSprite = function(sprite) {
  if(sprite)
  sprite.display();
};

/**
* Loads an animation.
* To be typically used in the preload() function of the sketch.
*
* @method loadAnimation
* @param {Sprite} sprite Sprite to be displayed
*/
p5.prototype.loadAnimation = function() {
  return construct(this.Animation, arguments);
};

/**
 * Loads a Sprite Sheet.
 * To be typically used in the preload() function of the sketch.
 *
 * @method loadSpriteSheet
 */
p5.prototype.loadSpriteSheet = function() {
  return construct(this.SpriteSheet, arguments);
};

/**
* Displays an animation.
*
* @method animation
* @param {Animation} anim Animation to be displayed
* @param {Number} x X coordinate
* @param {Number} y Y coordinate
*
*/
p5.prototype.animation = function(anim, x, y) {
  anim.draw(x, y);
};

//variable to detect instant presses
defineLazyP5Property('_p5play', function() {
  return {
    keyStates: {},
    mouseStates: {}
  };
});

var KEY_IS_UP = 0;
var KEY_WENT_DOWN = 1;
var KEY_IS_DOWN = 2;
var KEY_WENT_UP = 3;

/**
* Detects if a key was pressed during the last cycle.
* It can be used to trigger events once, when a key is pressed or released.
* Example: Super Mario jumping.
*
* @method keyWentDown
* @param {Number|String} key Key code or character
* @return {Boolean} True if the key was pressed
*/
p5.prototype.keyWentDown = function(key) {
  return this._isKeyInState(key, KEY_WENT_DOWN);
};


/**
* Detects if a key was released during the last cycle.
* It can be used to trigger events once, when a key is pressed or released.
* Example: Spaceship shooting.
*
* @method keyWentUp
* @param {Number|String} key Key code or character
* @return {Boolean} True if the key was released
*/
p5.prototype.keyWentUp = function(key) {
  return this._isKeyInState(key, KEY_WENT_UP);
};

/**
* Detects if a key is currently pressed
* Like p5 keyIsDown but accepts strings and codes
*
* @method keyDown
* @param {Number|String} key Key code or character
* @return {Boolean} True if the key is down
*/
p5.prototype.keyDown = function(key) {
  return this._isKeyInState(key, KEY_IS_DOWN);
};

/**
 * Detects if a key is in the given state during the last cycle.
 * Helper method encapsulating common key state logic; it may be preferable
 * to call keyDown or other methods directly.
 *
 * @private
 * @method _isKeyInState
 * @param {Number|String} key Key code or character
 * @param {Number} state Key state to check against
 * @return {Boolean} True if the key is in the given state
 */
p5.prototype._isKeyInState = function(key, state) {
  var keyCode;
  var keyStates = this._p5play.keyStates;

  if(typeof key === 'string')
  {
    keyCode = this._keyCodeFromAlias(key);
  }
  else
  {
    keyCode = key;
  }

  //if undefined start checking it
  if(keyStates[keyCode]===undefined)
  {
    if(this.keyIsDown(keyCode))
      keyStates[keyCode] = KEY_IS_DOWN;
    else
      keyStates[keyCode] = KEY_IS_UP;
  }

  return (keyStates[keyCode] === state);
};

/**
* Detects if a mouse button is currently down
* Combines mouseIsPressed and mouseButton of p5
*
* @method mouseDown
* @param {Number} [buttonCode] Mouse button constant LEFT, RIGHT or CENTER
* @return {Boolean} True if the button is down
*/
p5.prototype.mouseDown = function(buttonCode) {
  return this._isMouseButtonInState(buttonCode, KEY_IS_DOWN);
};

/**
* Detects if a mouse button is currently up
* Combines mouseIsPressed and mouseButton of p5
*
* @method mouseUp
* @param {Number} [buttonCode] Mouse button constant LEFT, RIGHT or CENTER
* @return {Boolean} True if the button is up
*/
p5.prototype.mouseUp = function(buttonCode) {
  return this._isMouseButtonInState(buttonCode, KEY_IS_UP);
};

/**
 * Detects if a mouse button was released during the last cycle.
 * It can be used to trigger events once, to be checked in the draw cycle
 *
 * @method mouseWentUp
 * @param {Number} [buttonCode] Mouse button constant LEFT, RIGHT or CENTER
 * @return {Boolean} True if the button was just released
 */
p5.prototype.mouseWentUp = function(buttonCode) {
  return this._isMouseButtonInState(buttonCode, KEY_WENT_UP);
};


/**
 * Detects if a mouse button was pressed during the last cycle.
 * It can be used to trigger events once, to be checked in the draw cycle
 *
 * @method mouseWentDown
 * @param {Number} [buttonCode] Mouse button constant LEFT, RIGHT or CENTER
 * @return {Boolean} True if the button was just pressed
 */
p5.prototype.mouseWentDown = function(buttonCode) {
  return this._isMouseButtonInState(buttonCode, KEY_WENT_DOWN);
};

/**
 * Returns a constant for a mouse state given a string or a mouse button constant.
 *
 * @private
 * @method _clickKeyFromString
 * @param {Number|String} [buttonCode] Mouse button constant LEFT, RIGHT or CENTER
 *   or string 'leftButton', 'rightButton', or 'centerButton'
 * @return {Number} Mouse button constant LEFT, RIGHT or CENTER or value of buttonCode
 */
p5.prototype._clickKeyFromString = function(buttonCode) {
  if (this.CLICK_KEY[buttonCode]) {
    return this.CLICK_KEY[buttonCode];
  } else {
    return buttonCode;
  }
};

// Map of strings to constants for mouse states.
p5.prototype.CLICK_KEY = {
  'leftButton': p5.prototype.LEFT,
  'rightButton': p5.prototype.RIGHT,
  'centerButton': p5.prototype.CENTER
};

/**
 * Detects if a mouse button is in the given state during the last cycle.
 * Helper method encapsulating common mouse button state logic; it may be
 * preferable to call mouseWentUp, etc, directly.
 *
 * @private
 * @method _isMouseButtonInState
 * @param {Number|String} [buttonCode] Mouse button constant LEFT, RIGHT or CENTER
 *   or string 'leftButton', 'rightButton', or 'centerButton'
 * @param {Number} state
 * @return {boolean} True if the button was in the given state
 */
p5.prototype._isMouseButtonInState = function(buttonCode, state) {
  var mouseStates = this._p5play.mouseStates;

  buttonCode = this._clickKeyFromString(buttonCode);

  if(buttonCode === undefined)
    buttonCode = this.LEFT;

  //undefined = not tracked yet, start tracking
  if(mouseStates[buttonCode]===undefined)
  {
  if (this._mouseButtonIsPressed(buttonCode))
    mouseStates[buttonCode] = KEY_IS_DOWN;
  else
    mouseStates[buttonCode] = KEY_IS_UP;
  }

  return (mouseStates[buttonCode] === state);
};

