package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/rs/cors"
)

// Config holds application configuration
type Config struct {
	Port         string
	OpenAIAPIKey string
}

// TranscribeRequest represents the incoming transcription request
type TranscribeRequest struct {
	URL string `json:"url"`
}

// TranscribeResponse represents the transcription response
type TranscribeResponse struct {
	OK         bool            `json:"ok"`
	URL        string          `json:"url"`
	Video      VideoMetadata   `json:"video"`
	Transcript TranscriptData  `json:"transcript"`
	Source     string          `json:"source"` // "youtube_captions" or "whisper_api"
}

// VideoMetadata represents metadata about the video
type VideoMetadata struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Channel     string `json:"channel"`
	ChannelURL  string `json:"channel_url"`
	Duration    int    `json:"duration"` // in seconds
	UploadDate  string `json:"upload_date"`
	ViewCount   int64  `json:"view_count"`
	Thumbnail   string `json:"thumbnail"`
}

// TranscriptData represents the transcript data with segments
type TranscriptData struct {
	Text     string              `json:"text"`     // Full transcript text
	Segments []TranscriptSegment `json:"segments"` // Timestamped segments
	Language string              `json:"language"` // Detected language
	Duration float64             `json:"duration"` // Duration in seconds
}

// TranscriptSegment represents a timestamped segment of the transcript
type TranscriptSegment struct {
	ID    int     `json:"id"`
	Start float64 `json:"start"` // Start time in seconds
	End   float64 `json:"end"`   // End time in seconds
	Text  string  `json:"text"`
}

// HealthResponse represents the health check response
type HealthResponse struct {
	OK      bool   `json:"ok"`
	Service string `json:"service"`
	Time    string `json:"time"`
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

var config Config

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found, using system environment variables")
	}

	// Initialize configuration
	config = Config{
		Port:         getEnv("PORT", "5055"),
		OpenAIAPIKey: getEnv("OPENAI_API_KEY", ""),
	}

	if config.OpenAIAPIKey == "" {
		log.Fatal("OPENAI_API_KEY environment variable is required")
	}

	// Create router
	mux := http.NewServeMux()

	// Register routes
	mux.HandleFunc("/api/health", healthHandler)
	mux.HandleFunc("/api/transcribe", transcribeHandler)

	// Setup CORS
	handler := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	}).Handler(mux)

	// Start server
	addr := ":" + config.Port
	log.Printf("Server starting on port %s", config.Port)
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatal(err)
	}
}

// healthHandler handles the health check endpoint
func healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	response := HealthResponse{
		OK:      true,
		Service: "phoenix-backend-transcriber",
		Time:    time.Now().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// transcribeHandler handles the transcription endpoint
func transcribeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req TranscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate URL
	if !isValidYouTubeURL(req.URL) {
		sendError(w, "Invalid YouTube URL", http.StatusBadRequest)
		return
	}

	// Create temporary directory
	tempDir, err := os.MkdirTemp("", "avi-transcribe-*")
	if err != nil {
		log.Printf("Error creating temp directory: %v", err)
		sendError(w, "Failed to create temporary directory", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(tempDir)

	// Get video metadata
	metadata, err := getVideoMetadata(req.URL)
	if err != nil {
		log.Printf("Error fetching video metadata: %v", err)
		sendError(w, "Failed to fetch video metadata. The video may be private, age-restricted, or unavailable.", http.StatusBadRequest)
		return
	}

	// Strategy 1: Try to get YouTube's native captions first (faster, no bot detection)
	log.Printf("Attempting to fetch YouTube captions for: %s", metadata.Title)
	transcript, source, err := getYouTubeCaptions(req.URL, tempDir)

	if err != nil {
		// Strategy 2: Fall back to downloading audio and using Whisper
		log.Printf("Captions not available, falling back to audio download: %v", err)

		audioFile, err := downloadYouTubeAudio(req.URL, tempDir)
		if err != nil {
			log.Printf("Error downloading YouTube audio: %v", err)
			sendError(w, "Failed to process video. Try a different video or check if it's publicly accessible.", http.StatusInternalServerError)
			return
		}

		transcript, err = transcribeAudioWithTimestamps(audioFile)
		if err != nil {
			log.Printf("Error transcribing audio: %v", err)
			sendError(w, fmt.Sprintf("Failed to transcribe audio: %v", err), http.StatusInternalServerError)
			return
		}
		source = "whisper_api"
	}

	// Send response
	response := TranscribeResponse{
		OK:         true,
		URL:        req.URL,
		Video:      metadata,
		Transcript: transcript,
		Source:     source,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// getYouTubeCaptions tries to fetch YouTube's native captions/subtitles
func getYouTubeCaptions(url, tempDir string) (TranscriptData, string, error) {
	// Use Python youtube-transcript-api to get transcripts directly
	// This bypasses all bot detection issues
	cmd := exec.Command("python3", "get_transcript.py", url)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return TranscriptData{}, "", fmt.Errorf("failed to get transcript: %v, output: %s", err, string(output))
	}

	// Parse JSON response
	var result struct {
		Success    bool   `json:"success"`
		Error      string `json:"error"`
		VideoID    string `json:"video_id"`
		Transcript []struct {
			Text     string  `json:"text"`
			Start    float64 `json:"start"`
			Duration float64 `json:"duration"`
		} `json:"transcript"`
	}

	if err := json.Unmarshal(output, &result); err != nil {
		return TranscriptData{}, "", fmt.Errorf("failed to parse transcript JSON: %v", err)
	}

	if !result.Success {
		return TranscriptData{}, "", fmt.Errorf("transcript fetch failed: %s", result.Error)
	}

	// Convert to our TranscriptData format
	var segments []TranscriptSegment
	var fullText strings.Builder
	totalDuration := 0.0

	for i, entry := range result.Transcript {
		segments = append(segments, TranscriptSegment{
			ID:    i + 1,
			Start: entry.Start,
			End:   entry.Start + entry.Duration,
			Text:  entry.Text,
		})
		fullText.WriteString(entry.Text)
		fullText.WriteString(" ")
		totalDuration = entry.Start + entry.Duration
	}

	log.Printf("Successfully extracted YouTube transcript with %d segments", len(segments))
	return TranscriptData{
		Text:     strings.TrimSpace(fullText.String()),
		Segments: segments,
		Language: "en",
		Duration: totalDuration,
	}, "youtube_transcript_api", nil
}

// parseVTTFile parses a WebVTT subtitle file
func parseVTTFile(filename string) (TranscriptData, error) {
	content, err := os.ReadFile(filename)
	if err != nil {
		return TranscriptData{}, err
	}

	lines := strings.Split(string(content), "\n")
	var segments []TranscriptSegment
	var fullText strings.Builder
	segmentID := 0

	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])

		// Skip WEBVTT header and blank lines
		if line == "" || strings.HasPrefix(line, "WEBVTT") || strings.HasPrefix(line, "Kind:") || strings.HasPrefix(line, "Language:") {
			continue
		}

		// Check if this is a timestamp line
		if strings.Contains(line, "-->") {
			parts := strings.Split(line, "-->")
			if len(parts) != 2 {
				continue
			}

			startTime := parseVTTTime(strings.TrimSpace(parts[0]))
			endTime := parseVTTTime(strings.TrimSpace(parts[1]))

			// Get the text (next non-empty line)
			i++
			var textLines []string
			for i < len(lines) && strings.TrimSpace(lines[i]) != "" {
				textLines = append(textLines, strings.TrimSpace(lines[i]))
				i++
			}

			if len(textLines) > 0 {
				text := strings.Join(textLines, " ")
				// Remove VTT formatting tags
				text = regexp.MustCompile(`<[^>]+>`).ReplaceAllString(text, "")

				segments = append(segments, TranscriptSegment{
					ID:    segmentID,
					Start: startTime,
					End:   endTime,
					Text:  text,
				})
				fullText.WriteString(text)
				fullText.WriteString(" ")
				segmentID++
			}
		}
	}

	duration := 0.0
	if len(segments) > 0 {
		duration = segments[len(segments)-1].End
	}

	return TranscriptData{
		Text:     strings.TrimSpace(fullText.String()),
		Segments: segments,
		Language: "en",
		Duration: duration,
	}, nil
}

// parseVTTTime converts VTT timestamp to seconds
func parseVTTTime(timestamp string) float64 {
	// Format: 00:00:00.000 or 00:00.000
	timestamp = strings.TrimSpace(timestamp)
	parts := strings.Split(timestamp, ":")

	var hours, minutes, seconds float64

	if len(parts) == 3 {
		fmt.Sscanf(parts[0], "%f", &hours)
		fmt.Sscanf(parts[1], "%f", &minutes)
		fmt.Sscanf(parts[2], "%f", &seconds)
	} else if len(parts) == 2 {
		fmt.Sscanf(parts[0], "%f", &minutes)
		fmt.Sscanf(parts[1], "%f", &seconds)
	}

	return hours*3600 + minutes*60 + seconds
}

// getVideoMetadata fetches video metadata using yt-dlp
func getVideoMetadata(url string) (VideoMetadata, error) {
	// Using mweb client as recommended by yt-dlp documentation
	args := []string{
		"--dump-json",
		"--no-playlist",
		"--skip-download",
		"--extractor-args", "youtube:player_client=mweb",
		url,
	}

	cmd := exec.Command("yt-dlp", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return VideoMetadata{}, fmt.Errorf("failed to fetch metadata: %v, output: %s", err, string(output))
	}

	var videoInfo struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Uploader    string `json:"uploader"`
		UploaderURL string `json:"uploader_url"`
		Duration    int    `json:"duration"`
		UploadDate  string `json:"upload_date"`
		ViewCount   int64  `json:"view_count"`
		Thumbnail   string `json:"thumbnail"`
	}

	if err := json.Unmarshal(output, &videoInfo); err != nil {
		return VideoMetadata{}, fmt.Errorf("failed to parse metadata: %v", err)
	}

	return VideoMetadata{
		Title:       videoInfo.Title,
		Description: videoInfo.Description,
		Channel:     videoInfo.Uploader,
		ChannelURL:  videoInfo.UploaderURL,
		Duration:    videoInfo.Duration,
		UploadDate:  videoInfo.UploadDate,
		ViewCount:   videoInfo.ViewCount,
		Thumbnail:   videoInfo.Thumbnail,
	}, nil
}

// downloadYouTubeAudio downloads audio from a YouTube URL using yt-dlp
func downloadYouTubeAudio(url, tempDir string) (string, error) {
	outputPath := filepath.Join(tempDir, "audio.mp3")

	// Using mweb client as recommended by yt-dlp documentation
	args := []string{
		"-f", "bestaudio/best",  // Select best audio format
		"-x",                     // Extract audio
		"--audio-format", "mp3",
		"-o", outputPath,
		"--no-playlist",
		"--extractor-args", "youtube:player_client=mweb",
		url,
	}

	cmd := exec.Command("yt-dlp", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("yt-dlp failed: %v, output: %s", err, string(output))
	}

	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		return "", fmt.Errorf("audio file was not created")
	}

	return outputPath, nil
}

// transcribeAudioWithTimestamps transcribes an audio file using OpenAI Whisper API
func transcribeAudioWithTimestamps(audioFilePath string) (TranscriptData, error) {
	file, err := os.Open(audioFilePath)
	if err != nil {
		return TranscriptData{}, fmt.Errorf("failed to open audio file: %v", err)
	}
	defer file.Close()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file", filepath.Base(audioFilePath))
	if err != nil {
		return TranscriptData{}, fmt.Errorf("failed to create form file: %v", err)
	}
	if _, err := io.Copy(part, file); err != nil {
		return TranscriptData{}, fmt.Errorf("failed to copy file data: %v", err)
	}

	if err := writer.WriteField("model", "whisper-1"); err != nil {
		return TranscriptData{}, fmt.Errorf("failed to write model field: %v", err)
	}

	if err := writer.WriteField("response_format", "verbose_json"); err != nil {
		return TranscriptData{}, fmt.Errorf("failed to write response_format field: %v", err)
	}

	if err := writer.WriteField("timestamp_granularities[]", "segment"); err != nil {
		return TranscriptData{}, fmt.Errorf("failed to write timestamp_granularities field: %v", err)
	}

	if err := writer.Close(); err != nil {
		return TranscriptData{}, fmt.Errorf("failed to close multipart writer: %v", err)
	}

	req, err := http.NewRequest("POST", "https://api.openai.com/v1/audio/transcriptions", body)
	if err != nil {
		return TranscriptData{}, fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Authorization", "Bearer "+config.OpenAIAPIKey)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return TranscriptData{}, fmt.Errorf("failed to send request: %v", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return TranscriptData{}, fmt.Errorf("failed to read response: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		return TranscriptData{}, fmt.Errorf("OpenAI API returned status %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Text     string  `json:"text"`
		Language string  `json:"language"`
		Duration float64 `json:"duration"`
		Segments []struct {
			ID    int     `json:"id"`
			Start float64 `json:"start"`
			End   float64 `json:"end"`
			Text  string  `json:"text"`
		} `json:"segments"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return TranscriptData{}, fmt.Errorf("failed to parse response: %v", err)
	}

	segments := make([]TranscriptSegment, len(result.Segments))
	for i, seg := range result.Segments {
		segments[i] = TranscriptSegment{
			ID:    seg.ID,
			Start: seg.Start,
			End:   seg.End,
			Text:  seg.Text,
		}
	}

	return TranscriptData{
		Text:     result.Text,
		Segments: segments,
		Language: result.Language,
		Duration: result.Duration,
	}, nil
}

// isValidYouTubeURL validates if a URL is a valid YouTube URL
func isValidYouTubeURL(url string) bool {
	if url == "" {
		return false
	}
	youtubePattern := regexp.MustCompile(`(?i)(youtube\.com|youtu\.be)`)
	return youtubePattern.MatchString(url)
}

// sendError sends an error response
func sendError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(ErrorResponse{
		OK:    false,
		Error: message,
	})
}

// getEnv gets an environment variable with a default value
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
