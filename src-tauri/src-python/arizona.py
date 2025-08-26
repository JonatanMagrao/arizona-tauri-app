import os
import re
import subprocess
from time import sleep

class Arizona:
    def __init__(self, ae_version):
        self.carrefour_path = os.path.normpath("J:/Drives compartilhados/Phx CRF")
        self.claro_path = os.path.normpath("J:/Drives compartilhados/Phx Talent/CLARO/2025")
        self.after_fx = os.path.normpath(f"C:/Program Files/Adobe/Adobe After Effects {ae_version}/Support Files/AfterFX.exe")
        self.photoshop = os.path.normpath(f"C:/Program Files/Adobe/Adobe Photoshop 2024/Photoshop.exe")
        self.meses = ["09_SETEMBRO","08_AGOSTO"]

    def open_visto(self):
        subprocess.run(["start", "https://carrefour.visto.global/app/workspace/tasks"], shell=True)

    def open_bitrix(self):
        subprocess.run(["start", "https://arizona.bitrix24.com/crm/type/1042/kanban/category/0/"], shell=True)

    def open_pip(self):
        subprocess.run(["start", "https://cfo-pip.arizonaapps.io/site/jobs"], shell=True)

    def open_claro(self):
        subprocess.run(["start", "https://talentmarcelclaro.visto.global/app/login"], shell=True)

    @property
    def open_produtos(self):
        subprocess.run(["explorer", os.path.join(self.carrefour_path, "CARREFOUR", "ASSETS", "_PRODUTOS")], shell=True)

    def open_render(self,jobao_cod,format):
        jobao_path = self.get_jobao_path(jobao_cod)        

        if(format.lower() == ".mp4" or format.lower() == ".mov"):   
            set_format = "MP4" if format.lower() == ".mp4" else "MOV"
            subprocess.run(["explorer", os.path.join(jobao_path, "OUT", "RENDER",set_format)], shell=True)
        elif(format.lower() == "raiz"):
            subprocess.run(["explorer", os.path.join(jobao_path, "OUT", "RENDER")], shell=True)

    def open_claro_folder(self):
        subprocess.run(["explorer", "I:\\Drives compartilhados\\Phx Talent\\CLARO\\2025\\02_FEVEREIRO"], shell=True)

    def criar_novo_projeto_claro(self, claro_cod):

        MESES = self.meses

        for mes in MESES:
            projeto_path = os.path.join(self.claro_path, mes)
            
            if os.path.exists(projeto_path):
                novo_projeto_path = os.path.join(projeto_path, f"CLARO - {claro_cod}")
                os.mkdir(novo_projeto_path)
                sleep(1)
                os.mkdir(os.path.join(novo_projeto_path, "OUT"))
                sleep(1)
                os.mkdir(os.path.join(novo_projeto_path, "PROJETO"))
                sleep(1)
                subprocess.run(["explorer", novo_projeto_path])
                return
            
        print(f"Não foi possível criar o projeto CLARO - {claro_cod} em {MESES[0]} nem em {MESES[1]}.")

            

    def open_tiago_folder(self):
        tiago_path = os.path.join(self.claro_path,"Tiago Leifert")
        subprocess.run(["explorer",tiago_path])        

    def open_claro_projeto(self, claro_cod):

        MESES = self.meses
        for mes in MESES:
            projeto_path = os.path.join(self.claro_path, mes, f"CLARO - {claro_cod}", "PROJETO")
            
            if os.path.exists(projeto_path):
                subprocess.run(["explorer", projeto_path])
                return
            
        print(f'O projeto "{claro_cod}" não foi encontrado em {MESES[0]} nem em {MESES[1]}!')
        return None


    def open_claro_out(self, claro_cod):

        MESES = self.meses
        for mes in MESES:
            projeto_path = os.path.join(self.claro_path, mes, f"CLARO - {claro_cod}", "OUT")
            
            if os.path.exists(projeto_path):
                subprocess.run(["explorer", projeto_path])
                return
            
        print(f'O projeto "{claro_cod}" não foi encontrado em {MESES[0]} nem em {MESES[1]}!')
        return None


    def open_claro_aep(self, claro_cod):

        MESES = self.meses
        for mes in MESES:
            projeto_path = os.path.join(self.claro_path, mes, f"CLARO - {claro_cod}", "PROJETO")
            
            if os.path.exists(projeto_path):
                after_proj = [arquivo for arquivo in os.listdir(projeto_path) if arquivo.endswith(".aep")]
                
                if after_proj:
                    after_proj_path = os.path.join(projeto_path, after_proj[0])
                    subprocess.Popen([self.after_fx, "-project", after_proj_path])
                    return None
                else:
                    print(f'Nenhum arquivo .aep foi encontrado no projeto "{claro_cod}".')
                    return None

        print(f'O projeto "{claro_cod}" não foi encontrado em {MESES[0]} nem em {MESES[1]}!')
        return None
    

    def open_claro_psd(self, claro_cod):

        MESES = self.meses

        for mes in MESES:
            projeto_path = os.path.join(self.claro_path, mes, f"CLARO - {claro_cod}")
            
            if os.path.exists(projeto_path):
                photoshop_proj = [arquivo for arquivo in os.listdir(projeto_path) if arquivo.endswith(".psd")]
                
                if photoshop_proj:
                    photoshop_path = os.path.join(projeto_path, photoshop_proj[0])
                    subprocess.Popen([self.photoshop, photoshop_path])
                    return None
                else:
                    print(f'Nenhum arquivo .psd foi encontrado no projeto "{claro_cod}".')
                    return None

        print(f'O projeto "{claro_cod}" não foi encontrado em {MESES[0]} nem em {MESES[1]}!')
        return None
   

    def get_jobao_path(self, jobao_cod):
        reg_exp = re.compile(rf'\d{{2}}_{jobao_cod}_\d{{5,6}}_w*')

        def get_directories(source):
            return [
                dirent for dirent in os.listdir(source)
                if os.path.isdir(os.path.join(source, dirent)) and re.match(r'\d{2}', dirent)
            ]

        MESES = self.meses

        for mes in MESES:
            projeto_path = os.path.join(self.carrefour_path, "CARREFOUR", "FILMES", "2025", mes)
            pastas = get_directories(projeto_path)

            for pasta in pastas:
                if reg_exp.search(pasta):
                    pasta_jobao = os.path.join(projeto_path, pasta)
                    return pasta_jobao

        if jobao_cod == "":
            print("Campo Jobão vazio!")
        else:
            print(f'Jobão "{jobao_cod}" não encontrado em {MESES[0]} nem em {MESES[1]}!')
        
        return None


    def open_jobao(self, jobao_cod):
        jobao_path = self.get_jobao_path(jobao_cod)
        if jobao_path:
            subprocess.run(["explorer", jobao_path], shell=True)

    def open_produtos_jobao(self, jobao_cod):
        jobao_path = self.get_jobao_path(jobao_cod)
        if jobao_path:
            subprocess.run(["explorer", os.path.join(jobao_path, "PRODUTOS")], shell=True)

    def open_jobinhos_folder(self, jobao_cod, jobinho_cod):
        jobao_path = os.path.join(self.get_jobao_path(jobao_cod), "PROJETOS", "AE")
        reg_exp = re.compile(rf'{jobinho_cod}_')

        arquivos = [arquivo for arquivo in os.listdir(jobao_path) if arquivo.endswith(".aep")]

        for arquivo in arquivos:
            if reg_exp.search(arquivo):
                subprocess.run(["explorer", jobao_path], shell=True)
                return

    def abrir_jobinho(self, jobao_cod, jobinho_cod):
        jobao_path = os.path.join(self.get_jobao_path(jobao_cod), "PROJETOS", "AE")
        reg_exp = re.compile(rf'{jobinho_cod}_')

        arquivos = [arquivo for arquivo in os.listdir(jobao_path) if arquivo.endswith(".aep")]

        for arquivo in arquivos:
            if reg_exp.search(arquivo):
                subprocess.Popen([self.after_fx, "-project", os.path.join(jobao_path, arquivo)])
                return
        
        print(f'Código Jobinho "{jobinho_cod}" inválido!')
        return False
            
    def find_prod(self, pesquisa):
        # Percorre todos os diretórios e subdiretórios
        found_files = []
        for root, dirs, files in os.walk(os.path.join(self.carrefour_path,"CARREFOUR","ASSETS","_PRODUTOS")):
            # Verifica se algum arquivo contém a palavra de pesquisa
            for file in files:
                if ".psd" in file.lower() and pesquisa.lower() in file:
                    found_files.append({
                        "nome":file,
                        "path":"./icons/img.png"
                    })
                    continue

                if pesquisa.lower() in file.lower():
                    # Retorna o caminho completo do arquivo encontrado
                    # return os.path.join(root, file)
                    found_files.append({
                        "nome":file,
                        "path":os.path.join(root,file)
                    })
        
        # Retorna False se o arquivo não for encontrado
        return found_files if found_files else [{"nome":"Não existe no Banco de Dados","path":"./icons/sad.png"}]

# Para usar o módulo:
# from arizona import Arizona
# instance = Arizona("2023")
