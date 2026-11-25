// What AVFoundation (QuickTime, Resolume Arena on macOS) reads from exported MP4s: duration, nominal frame rate,
// and the sample count and timestamps. macOS only, so not in CI.
//   swift prototypes/output-video/avfoundation-check.swift file.mp4 …
import AVFoundation

for path in CommandLine.arguments.dropFirst() {
  let asset = AVURLAsset(url: URL(fileURLWithPath: path))
  let done = DispatchSemaphore(value: 0)
  Task {
    do {
      let duration = try await asset.load(.duration).seconds
      guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw CocoaError(.fileReadCorruptFile) }
      let (rate, size) = try await track.load(.nominalFrameRate, .naturalSize)
      let reader = try AVAssetReader(asset: asset)
      let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
      reader.add(output)
      reader.startReading()
      var count = 0
      var last = 0.0
      while let sample = output.copyNextSampleBuffer() {
        if CMSampleBufferGetNumSamples(sample) == 0 { continue }
        last = CMSampleBufferGetPresentationTimeStamp(sample).seconds
        count += CMSampleBufferGetNumSamples(sample)
      }
      print("\(path): \(Int(size.width)) x \(Int(size.height)), \(duration) s, \(rate) fps, \(count) samples, last at \(last) s")
    } catch { print("\(path): \(error)") }
    done.signal()
  }
  done.wait()
}
