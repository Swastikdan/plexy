#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>

extern "C" uint8_t *plexy_artwork_thumbnail(const uint8_t *bytes, size_t length,
                                            uint32_t targetWidth, uint32_t targetHeight, bool cover,
                                            uint32_t *width, uint32_t *height) {
  @autoreleasepool {
    NSData *data = [NSData dataWithBytesNoCopy:const_cast<uint8_t *>(bytes) length:length freeWhenDone:NO];
    NSDictionary *sourceOptions = @{ (__bridge NSString *)kCGImageSourceShouldCache: @NO };
    CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data,
                                                        (__bridge CFDictionaryRef)sourceOptions);
    if (!source) return nullptr;
    NSDictionary *properties = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, 0, nullptr));
    auto w = [properties[(__bridge NSString *)kCGImagePropertyPixelWidth] unsignedIntValue];
    auto h = [properties[(__bridge NSString *)kCGImagePropertyPixelHeight] unsignedIntValue];
    if (!w || !h || w > 8192 || h > 8192 || uint64_t(w) * h > 32 * 1024 * 1024) {
      CFRelease(source);
      return nullptr;
    }
    int orientation = [properties[(__bridge NSString *)kCGImagePropertyOrientation] intValue];
    if (orientation >= 5 && orientation <= 8) std::swap(w, h);
    double sx = double(targetWidth) / w, sy = double(targetHeight) / h;
    double scaled = std::max(w, h) * (cover ? std::max(sx, sy) : std::min(sx, sy));
    uint32_t maxSide = std::min({1600u, std::max(w, h), std::max(1u, uint32_t(std::ceil(scaled)))});
    NSDictionary *options = @{
      (__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
      (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform: @YES,
      (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize: @(maxSide)
    };
    CGImageRef image = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
    CFRelease(source);
    if (!image) return nullptr;
    size_t outWidth = CGImageGetWidth(image), outHeight = CGImageGetHeight(image);
    uint8_t *pixels = nullptr;
    if (outWidth > 0 && outHeight > 0 && outWidth <= maxSide && outHeight <= maxSide) {
      size_t stride = outWidth * 4;
      pixels = static_cast<uint8_t *>(calloc(outHeight, stride));
      if (pixels) {
        CGColorSpaceRef color = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
        CGContextRef bitmap = CGBitmapContextCreate(pixels, outWidth, outHeight, 8, stride, color,
          kCGBitmapByteOrder32Little | kCGImageAlphaPremultipliedFirst);
        CGColorSpaceRelease(color);
        if (bitmap) {
          CGContextDrawImage(bitmap, CGRectMake(0, 0, outWidth, outHeight), image);
          CGContextRelease(bitmap);
          // GPUI's RenderImage takes straight-alpha BGRA.
          for (size_t i = 0; i < stride * outHeight; i += 4) {
            unsigned a = pixels[i + 3];
            if (a > 0 && a < 255) {
              for (size_t channel = 0; channel < 3; ++channel) {
                pixels[i + channel] = std::min(255u, (pixels[i + channel] * 255u + a / 2) / a);
              }
            }
          }
          *width = uint32_t(outWidth);
          *height = uint32_t(outHeight);
        } else {
          free(pixels);
          pixels = nullptr;
        }
      }
    }
    CGImageRelease(image);
    return pixels;
  }
}

extern "C" void plexy_artwork_free(uint8_t *pixels) {
  free(pixels);
}
