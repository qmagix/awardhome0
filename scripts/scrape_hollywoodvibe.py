import os
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import time

def download_pdfs(url, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    print(f"Fetching main page: {url}")
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    
    soup = BeautifulSoup(response.content, 'html.parser')
    
    season_links = set()
    for a in soup.find_all('a', href=True):
        href = a['href']
        if '-season-results/' in href.lower():
            season_links.add(urljoin(url, href))
            
    print(f"Found {len(season_links)} season result pages.")
    
    all_pdf_links = set()
    
    for season_url in season_links:
        print(f"Fetching season page: {season_url}")
        try:
            res = requests.get(season_url, headers=headers)
            res.raise_for_status()
            season_soup = BeautifulSoup(res.content, 'html.parser')
            
            for a in season_soup.find_all('a', href=True):
                href = a['href']
                if '.pdf' in href.lower():
                    all_pdf_links.add(urljoin(season_url, href))
        except Exception as e:
            print(f"Error fetching {season_url}: {e}")
            
        time.sleep(1) # Be polite
            
    print(f"Found {len(all_pdf_links)} unique PDF links across all seasons.")
    
    for i, pdf_url in enumerate(all_pdf_links):
        try:
            parsed = urlparse(pdf_url)
            filename = os.path.basename(parsed.path)
            if not filename.lower().endswith('.pdf'):
                filename = f"document_{i}.pdf"
                
            filepath = os.path.join(output_dir, filename)
            
            # Skip if already exists
            if os.path.exists(filepath):
                # print(f"Skipping {filename}, already exists.")
                continue
                
            print(f"[{i+1}/{len(all_pdf_links)}] Downloading {filename}...")
            pdf_resp = requests.get(pdf_url, headers=headers, stream=True)
            pdf_resp.raise_for_status()
            
            with open(filepath, 'wb') as f:
                for chunk in pdf_resp.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            time.sleep(0.5)  # Be polite
        except Exception as e:
            print(f"Failed to download {pdf_url}: {e}")

if __name__ == '__main__':
    url = "https://www.hollywoodvibe.com/results/"
    output_dir = "tobeprocessed/pdf"
    download_pdfs(url, output_dir)
